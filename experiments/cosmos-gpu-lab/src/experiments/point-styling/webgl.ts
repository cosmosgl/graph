import { Texture, UniformStore, type Buffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import shapeGeometry from '../../../../../src/modules/Shared/shape-geometry-module.ts?raw'
import oklab from '../../../../../src/modules/Shared/oklab-module.ts?raw'
import pickingColor from '../../../../../src/modules/Shared/picking-color-module.ts?raw'
import vs from '../../../../../src/modules/Points/draw-points.vert?raw'
import fs from '../../../../../src/modules/Points/draw-points.frag?raw'
import pointSize from '../../../../../src/modules/Points/point-size.glsl?raw'
import exitRamp from '../../../../../src/modules/Points/exit-ramp.glsl?raw'
import { ALPHA_BLEND, createDevice } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { dimensions, floatPixels, pixels, target, type Backend, type Snapshot } from './backend'
import { HEIGHT, WIDTH } from './data'
import { SOURCE_ALPHA_GLSL } from './source-alpha'

// Declaration order matches the production std140 blocks verbatim.
const vertexTypes = {
  ratio: 'f32',
  transformationMatrix: 'mat4x4<f32>',
  pointsTextureSize: 'f32',
  sizeScale: 'f32',
  worldOrigin: 'vec2<f32>',
  screenSize: 'vec2<f32>',
  greyoutColor: 'vec4<f32>',
  backgroundColor: 'vec4<f32>',
  scalePointsOnZoom: 'f32',
  maxPointSize: 'f32',
  isDarkenGreyout: 'f32',
  skipHighlighted: 'f32',
  skipGreyed: 'f32',
  hasImages: 'f32',
  imageCount: 'f32',
  imageAtlasCoordsTextureSize: 'f32',
  transitionProgress: 'f32',
  animateColors: 'f32',
  animateSizes: 'f32',
  animatePositions: 'f32',
  pointDefaultColor: 'vec4<f32>',
  pointDefaultSize: 'f32',
  pointsNumber: 'f32',
  strokeContrast: 'f32',
  strokeDefaultShade: 'f32',
  strokeDefaultWidth: 'f32',
  strokeDefaultColor: 'vec4<f32>',
  animateStrokeColors: 'f32',
  animateStrokeWidths: 'f32',
  ringDefaultColor: 'vec4<f32>',
  ringDefaultShade: 'f32',
  ringContrast: 'f32',
} as const
const fragmentTypes = {
  greyoutOpacity: 'f32',
  pointOpacity: 'f32',
  isDarkenGreyout: 'f32',
  backgroundColor: 'vec4<f32>',
  outlineWidth: 'f32',
  renderMode: 'f32',
  pickingAlpha: 'f32',
  pickingIndexOffset: 'f32',
} as const

// These production modules are GLSL template literals without substitutions.
// Reading their source avoids importing production luma v9 types into the v10 lab.
function moduleSource (source: string): string {
  const match = source.match(/\/\* glsl \*\/\s*`([^`]+)`/)
  if (!match || match[1].includes('${')) throw new Error('Unsupported production shader module source')
  return match[1]
}

function coordinateSources (quads: boolean, alphaPolicy: 'unchanged' | 'quantized' | 'eligibility' = 'unchanged'):
{ vertex: string; fragment: string } {
  const position = 'gl_Position = vec4(finalPosition.rg, depthZ, 1.0);'
  const coord = 'vec2 pointCoord = 2.0 * gl_PointCoord - 1.0;'
  const size = 'overallSize = overallSizeValue;'
  if (!vs.includes(position) || !vs.includes(size) || !fs.includes(coord)) throw new Error('Production coordinate control location changed')
  let vertex = vs.replace('void main()', 'flat out vec2 diagnosticCenter;\nvoid main()')
    .replace(position, `${position}\ndiagnosticCenter = (finalPosition.rg * 0.5 + 0.5) * screenSize * ratio;`)
  if (quads) {
    vertex = vertex.replace(size, `${size}
    const vec2 corners[6] = vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(-1,1),vec2(1,-1),vec2(1,1));
    // Pad the carrier by one device pixel on every side. The fragment performs
    // the original closed scalar bounds; padding never increases shape size.
    gl_Position.xy += corners[gl_VertexID] * (overallSizeValue + 2.0) / (screenSize * ratio);`)
  }
  let fragment = fs.replace('void main()', 'flat in vec2 diagnosticCenter;\nvoid main()')
    .replace(coord, `vec2 pointCoord = (gl_FragCoord.xy - diagnosticCenter) * vec2(2.0, -2.0) / overallSize;
      ${quads ? 'if (abs(pointCoord.x) > 1.0 || abs(pointCoord.y) > 1.0) discard;' : ''}`)
  if (quads) {
    const picking = 'if (renderMode > 2.5) {'
    if (!fragment.includes(picking)) throw new Error('Production picking control location changed')
    fragment = fragment.replace(picking, `${picking}\nif (pointOpacity <= 0.0) discard;`)
    if (alphaPolicy === 'quantized') {
      const alpha = 'finalPointAlpha *= pointOpacity;'
      if (!fragment.includes(alpha)) throw new Error('Production source-alpha location changed')
      fragment = fragment.replace('void main()', `${SOURCE_ALPHA_GLSL}\nvoid main()`)
        .replace(picking, `float candidateSourceAlpha = quantizeSourceAlpha(finalShapeColor.a * pointOpacity);
          ${picking}\nif (candidateSourceAlpha <= 0.0) discard;`)
        .replace(alpha, 'finalPointAlpha = candidateSourceAlpha;')
    } else if (alphaPolicy === 'eligibility') {
      // Only the ID pass uses the source byte. Leave color alpha and blending
      // exactly as in the explicit control, including faint-source accumulation.
      fragment = fragment.replace('void main()', `${SOURCE_ALPHA_GLSL}\nvoid main()`)
        .replace(picking, `${picking}\nif (quantizeSourceAlpha(finalShapeColor.a * pointOpacity) <= 0.0) discard;`)
    }
  }
  return { vertex, fragment }
}

function instrumentCoverage (fragment: string): string {
  const marker = 'shapeCoverage = opacity;'
  if (!fragment.includes(marker)) throw new Error('Production coverage probe location changed')
  return fragment.replace(marker, `${marker}
    if (renderMode == 4.0) { fragColor = vec4(pointCoord, coreDiameterPx, shapeDiameterPx); return; }
    if (renderMode == 5.0) { fragColor = vec4(coreCoord, edgeDistancePx, opacity); return; }`)
}

export async function createStylingWebGL (canvas: HTMLCanvasElement): Promise<Backend> {
  const device = await createDevice('webgl', canvas, false); const scope = resourceScope()
  try {
    const uniforms = scope.own(new UniformStore(device, {
      drawVertexUniforms: { uniformTypes: vertexTypes }, drawFragmentUniforms: { uniformTypes: fragmentTypes },
    }))
    const attributes = [
      ['pointIndices', 'float32x2'], ['sourceSize', 'float32'], ['targetSize', 'float32'],
      ['sourceColor', 'float32x4'], ['targetColor', 'float32x4'], ['shape', 'float32'],
      ['imageIndex', 'float32'], ['imageSize', 'float32'], ['renderRank', 'float32'],
      ['sourceStrokeColor', 'float32x4'], ['targetStrokeColor', 'float32x4'],
      ['sourceStrokeWidth', 'float32'], ['targetStrokeWidth', 'float32'],
    ] as const
    const models: Array<{ model: Model; quads: boolean }> = []
    const make = (picking: boolean, fragment = fs, vertex = vs, quads = false): Model => {
      const model = scope.own(new Model(device, {
        vs: vertex,
        fs: fragment,
        topology: quads ? 'triangle-list' : 'point-list',
        vertexCount: 0,
        modules: [{ name: 'shapeGeometry', vs: moduleSource(shapeGeometry), fs: moduleSource(shapeGeometry) },
          { name: 'oklab', vs: moduleSource(oklab), fs: moduleSource(oklab) }, { name: 'pickingColor', fs: moduleSource(pickingColor) },
          { name: 'pointSize', vs: pointSize, fs: pointSize }, { name: 'exitRamp', vs: exitRamp }],
        defines: {
          USE_UNIFORM_BUFFERS: true,
          POINT_STROKE: true,
          ...({
            EXIT_DEFAULT_SIZE: '0.0', EXIT_DEFAULT_COLOR_CHANNEL: '0.0', EDGE_RAMP_PX: '1.0', POINT_RING_SCALE: '1.3',
          } as unknown as Record<string, boolean>),
        },
        bufferLayout: attributes.map(([name, format]) => ({ name, format, stepMode: quads ? 'instance' : 'vertex' })),
        bindings: {
          drawVertexUniforms: uniforms.getManagedUniformBuffer('drawVertexUniforms'),
          drawFragmentUniforms: uniforms.getManagedUniformBuffer('drawFragmentUniforms'),
        },
        parameters: { ...(picking ? { blend: false } : ALPHA_BLEND), depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none' },
      }))
      models.push({ model, quads }); return model
    }
    const visible = make(false); const picking = make(true)
    let diagnostic: Model | undefined
    let analyticColor: Model | undefined; let analyticPick: Model | undefined
    let explicitColor: Model | undefined; let explicitPick: Model | undefined; let explicitProbe: Model | undefined
    let quantizedColor: Model | undefined; let quantizedPick: Model | undefined; let quantizedProbe: Model | undefined
    let eligibilityColor: Model | undefined; let eligibilityPick: Model | undefined; let eligibilityProbe: Model | undefined
    return {
      info: `${String(device.info.vendor)} / ${String(device.info.renderer)}`,
      async render (points, settings, diagnose = false, variant = 'production', display = true): Promise<Snapshot> {
        const frame = resourceScope()
        try {
          const [width, height] = dimensions(settings)
          if (display) { canvas.width = width; canvas.height = height; device.canvasContext!.resize({ width, height }) }
          const color = frame.own(target(device, width, height)); const ids = frame.own(target(device, width, height))
          const size = Math.max(1, Math.ceil(Math.sqrt(points.length))); const positions = new Float32Array(size * size * 4)
          const absent = positions.slice()
          points.forEach((p, i) => { positions.set([p.x - WIDTH / 2, HEIGHT / 2 - p.y, 0, 0], i * 4); absent[i * 4 + 1] = p.absent ? 1 : 0 })
          const texture = (data: Float32Array): Texture => {
            const result = frame.own(device.createTexture({
              width: size,
              height: size,
              format: 'rgba32float',
              usage: Texture.SAMPLE | Texture.COPY_DST,
              sampler: { minFilter: 'nearest', magFilter: 'nearest' },
            }))
            result.copyImageData({ data, bytesPerRow: size * 16 }); return result
          }
          const zero = texture(new Float32Array(positions.length))
          const bindings = {
            positionsTexture: texture(positions),
            exitTexture: texture(absent),
            pointStatus: zero,
            imageAtlasCoords: zero,
            imageAtlasTexture: zero,
          }
          const order = points.map((_, i) => i); if (settings.reverse) order.reverse()
          const records: Record<string, Buffer> = {}
          for (const [name] of attributes) {
            const values = order.flatMap((id, rank) => {
              const p = points[id]
              switch (name) {
              case 'pointIndices': return [id % size, Math.floor(id / size)]
              case 'sourceSize': case 'targetSize': return [p.size]
              case 'sourceColor': case 'targetColor': return p.color
              case 'shape': return [p.shape]
              case 'imageIndex': return [-1]
              case 'imageSize': return [0]
              case 'renderRank': return [rank]
              case 'sourceStrokeWidth': case 'targetStrokeWidth': return [p.stroke]
              default: return p.strokeColor
              }
            })
            records[name] = frame.own(device.createBuffer({ data: new Float32Array(values.length ? values : [0, 0, 0, 0]) }))
          }
          if (variant === 'explicit' && !explicitColor) {
            const { vertex, fragment } = coordinateSources(true)
            explicitColor = make(false, fragment, vertex, true); explicitPick = make(true, fragment, vertex, true)
            explicitProbe = make(true, instrumentCoverage(fragment), vertex, true)
          }
          if (variant === 'quantized' && !quantizedColor) {
            const { vertex, fragment } = coordinateSources(true, 'quantized')
            quantizedColor = make(false, fragment, vertex, true); quantizedPick = make(true, fragment, vertex, true)
            quantizedProbe = make(true, instrumentCoverage(fragment), vertex, true)
          }
          if (variant === 'eligibility' && !eligibilityColor) {
            const { vertex, fragment } = coordinateSources(true, 'eligibility')
            eligibilityColor = make(false, fragment, vertex, true); eligibilityPick = make(true, fragment, vertex, true)
            eligibilityProbe = make(true, instrumentCoverage(fragment), vertex, true)
          }
          if (diagnose && variant === 'production' && !diagnostic) {
            // Instrument a copy, leaving the production color/picking shader untouched.
            diagnostic = make(true, instrumentCoverage(fs))
            const { vertex, fragment } = coordinateSources(false)
            analyticColor = make(false, fragment, vertex); analyticPick = make(true, fragment, vertex)
          }
          for (const { model, quads } of models) {
            model.setAttributes(records); model.setBindings(bindings); model.setVertexCount(quads ? 6 : points.length)
            if (quads) model.setInstanceCount(points.length)
          }
          uniforms.setUniforms({
            drawVertexUniforms: {
              ratio: settings.ratio,
              transformationMatrix: [settings.zoom, 0, 0, 0, 0, settings.zoom, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
              pointsTextureSize: size,
              sizeScale: settings.sizeScale,
              worldOrigin: [0, 0],
              screenSize: [WIDTH, HEIGHT],
              greyoutColor: [-1, -1, -1, -1],
              backgroundColor: [0, 0, 0, 0],
              scalePointsOnZoom: Number(settings.scaleOnZoom),
              maxPointSize: settings.maxSize,
              isDarkenGreyout: 1,
              skipHighlighted: 0,
              skipGreyed: 0,
              hasImages: 0,
              imageCount: 0,
              imageAtlasCoordsTextureSize: size,
              transitionProgress: 1,
              animateColors: 0,
              animateSizes: 0,
              animatePositions: 0,
              pointDefaultColor: settings.defaultColor,
              pointDefaultSize: settings.defaultSize,
              pointsNumber: points.length,
              strokeContrast: 0,
              strokeDefaultShade: 2,
              strokeDefaultWidth: settings.defaultStroke,
              strokeDefaultColor: settings.defaultStrokeColor,
              animateStrokeColors: 0,
              animateStrokeWidths: 0,
              ringDefaultColor: [1, 1, 1, 1],
              ringDefaultShade: 2,
              ringContrast: 0,
            },
          })
          const draw = (model: Model, mode: number, framebuffer?: ReturnType<typeof target>['framebuffer']): void => {
            uniforms.setUniforms({
              drawFragmentUniforms: {
                greyoutOpacity: -1,
                pointOpacity: settings.opacity,
                isDarkenGreyout: 1,
                backgroundColor: [0, 0, 0, 0],
                outlineWidth: 0.9,
                renderMode: mode,
                pickingAlpha: 1,
                pickingIndexOffset: 0,
              },
            })
            const pass = device.beginRenderPass({ framebuffer, clearColor: framebuffer ? [0, 0, 0, 0] : [0.14, 0.16, 0.185, 1], clearDepth: false })
            try { model.draw(pass) } finally { pass.end() }
          }
          const colorModel = variant === 'eligibility'
            ? eligibilityColor!
            : variant === 'quantized' ? quantizedColor! : variant === 'explicit' ? explicitColor! : visible
          const pickModel = variant === 'eligibility'
            ? eligibilityPick!
            : variant === 'quantized' ? quantizedPick! : variant === 'explicit' ? explicitPick! : picking
          draw(colorModel, 0, color.framebuffer); draw(pickModel, 3, ids.framebuffer)
          if (display) draw(colorModel, 0)
          device.submit()
          const result: Snapshot = {
            pickingRule: variant === 'production' ? 'legacy' : variant === 'explicit' ? 'visible' : 'source-alpha',
            width,
            height,
            color: await pixels(device, color.texture, color.framebuffer),
            ids: await pixels(device, ids.texture, ids.framebuffer),
          }
          if (diagnose) {
            const geometry = frame.own(target(device, width, height, 'rgba32float'))
            const edge = frame.own(target(device, width, height, 'rgba32float'))
            const probe = variant === 'eligibility'
              ? eligibilityProbe!
              : variant === 'quantized' ? quantizedProbe! : variant === 'explicit' ? explicitProbe! : diagnostic!
            draw(probe, 4, geometry.framebuffer); draw(probe, 5, edge.framebuffer); device.submit()
            result.probe = {
              geometry: await floatPixels(device, geometry.texture, geometry.framebuffer), edge: await floatPixels(device, edge.texture, edge.framebuffer),
            }
          }
          if (diagnose && variant === 'production') {
            const analytic = frame.own(target(device, width, height)); const analyticIds = frame.own(target(device, width, height))
            draw(analyticColor!, 0, analytic.framebuffer); draw(analyticPick!, 3, analyticIds.framebuffer); device.submit()
            result.analyticControl = {
              pickingRule: 'legacy',
              width,
              height,
              color: await pixels(device, analytic.texture, analytic.framebuffer),
              ids: await pixels(device, analyticIds.texture, analyticIds.framebuffer),
            }
          }
          if (device.isLost) throw new Error('WebGL device lost')
          return result
        } finally { frame.destroy() }
      },
      destroy (): void { try { scope.destroy() } finally { device.destroy() } },
    }
  } catch (error) { try { scope.destroy() } finally { device.destroy() }; throw error }
}
