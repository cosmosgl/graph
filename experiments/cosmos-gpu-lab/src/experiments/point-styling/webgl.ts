import { Texture, UniformStore, type Buffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import shapeGeometry from '../../../../../src/modules/Shared/shape-geometry-module.ts?raw'
import oklab from '../../../../../src/modules/Shared/oklab-module.ts?raw'
import pickingColor from '../../../../../src/modules/Shared/picking-color-module.ts?raw'
import vs from '../../../../../src/modules/Points/draw-points.vert?raw'
import fs from '../../../../../src/modules/Points/draw-points.frag?raw'
import pointSize from '../../../../../src/modules/Points/point-size.glsl?raw'
import exitRamp from '../../../../../src/modules/Points/exit-ramp.glsl?raw'
import { ALPHA_BLEND, createDevice, describeDevice } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import type { StoredAlphaPassTimer } from './stored-alpha-timing'
import { resolveStoredAlpha, validateStoredAlpha, regionScissor, type StoredAlphaOptions } from './stored-alpha'
import { dimensions, floatPixels, pixels, target, type Backend, type RenderVariant, type Snapshot } from './backend'
import { HEIGHT, WIDTH, type Point, type Settings } from './data'
import { SOURCE_ALPHA_GLSL } from './source-alpha'
import { atlasTexture, atlasCoords, atlasInfo, GUTTER_SIZE, sourceTexelRects } from './atlas'
import { createDynamicAtlas } from './dynamic-atlas'
import { greyed, overlayIndices } from './point-effects'
import polygonPixels from './polygon-pixels.glsl?raw'
import { createPointOverlays } from './rings-webgl'

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

// A candidate must stop if a production shader edit moves or duplicates a patch site.
function patchShader (source: string, marker: string, replacement: string, expected = 1): string {
  const parts = source.split(marker)
  if (parts.length !== expected + 1) throw new Error(`Expected ${expected} production shader site(s) for "${marker}", found ${parts.length - 1}`)
  return parts.join(replacement)
}

function coordinateSources (
  quads: boolean, alphaPolicy: 'unchanged' | 'quantized' | 'eligibility' = 'unchanged', clampTile = false, texel = false, pixelPolygons = false
):
{ vertex: string; fragment: string } {
  const position = 'gl_Position = vec4(finalPosition.rg, depthZ, 1.0);'
  const coord = 'vec2 pointCoord = 2.0 * gl_PointCoord - 1.0;'
  const size = 'overallSize = overallSizeValue;'
  let vertex = patchShader(vs, 'void main()', 'flat out vec2 diagnosticCenter;\nvoid main()')
  vertex = patchShader(vertex, position, `${position}\ndiagnosticCenter = (finalPosition.rg * 0.5 + 0.5) * screenSize * ratio;`)
  if (quads) {
    vertex = patchShader(vertex, size, `${size}
    const vec2 corners[6] = vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(-1,1),vec2(1,-1),vec2(1,1));
    // Pad the carrier by one device pixel on every side. The fragment performs
    // the original closed scalar bounds; padding never increases shape size.
    gl_Position.xy += corners[gl_VertexID] * (overallSizeValue + 2.0) / (screenSize * ratio);`)
  }
  let fragment = patchShader(fs, 'void main()', 'flat in vec2 diagnosticCenter;\nvoid main()')
  fragment = patchShader(fragment, coord, `vec2 pointCoord = (gl_FragCoord.xy - diagnosticCenter) * vec2(2.0, -2.0) / overallSize;
      ${quads ? 'if (abs(pointCoord.x) > 1.0 || abs(pointCoord.y) > 1.0) discard;' : ''}`)
  if (quads) {
    // Outline padding is a carrier size, not part of the body geometry. Avoid
    // normalizing by that size and multiplying it back into the body contour.
    fragment = patchShader(fragment, 'vec2 coreCoord = shapeCoord * (shapeDiameterPx / coreDiameterPx);',
      `vec2 coreCoord = shapeCoord * (shapeDiameterPx / coreDiameterPx);
       if (isOutlined > 0.0) coreCoord = (gl_FragCoord.xy - diagnosticCenter) * vec2(2.0, -2.0) / coreDiameterPx;`)
    fragment = patchShader(fragment, 'float rPx = length(coreCoord) * coreDiameterPx * 0.5;',
      'float rPx = isOutlined > 0.0 ? length(gl_FragCoord.xy - diagnosticCenter) : length(coreCoord) * coreDiameterPx * 0.5;')
    if (pixelPolygons) {
      vertex = patchShader(vertex, 'void main()', 'flat out vec2 diagnosticShapeBounds;\nvoid main()')
      vertex = patchShader(vertex, size, `${size}\ndiagnosticShapeBounds = vec2(0.45,0.275) * max(shapeSize,1.0);`)
      fragment = patchShader(fragment, 'void main()', 'flat in vec2 diagnosticShapeBounds;\nvoid main()')
      fragment = patchShader(fragment, 'void main()', `${polygonPixels}\nvoid main()`)
      fragment = patchShader(fragment, 'float opacity = 1.0 - smoothstep(-halfRampPx, halfRampPx, edgeDistancePx);',
        `if (pointShape == 2.0 || pointShape == 3.0 || pointShape == 6.0) {
             edgeDistancePx = polygonPixelDistance((gl_FragCoord.xy - diagnosticCenter) * vec2(1,-1), coreDiameterPx, pointShape, diagnosticShapeBounds);
           }
           float opacity = 1.0 - smoothstep(-halfRampPx, halfRampPx, edgeDistancePx);`)
    }
    const picking = 'if (renderMode > 2.5) {'
    fragment = patchShader(fragment, picking, `${picking}\nif ((isGreyedOut > 0.0 && greyoutOpacity != -1.0
      ? greyoutOpacity : pointOpacity) <= 0.0) discard;`)
    if (alphaPolicy === 'quantized') {
      const alpha = 'finalPointAlpha *= pointOpacity;'
      fragment = patchShader(fragment, 'void main()', `${SOURCE_ALPHA_GLSL}\nvoid main()`)
      fragment = patchShader(fragment, picking, `float candidateSourceAlpha = quantizeSourceAlpha(max(finalShapeColor.a, finalImageColor.a) *
          (isGreyedOut > 0.0 && greyoutOpacity != -1.0 ? greyoutOpacity : pointOpacity));
          ${picking}\nif (candidateSourceAlpha <= 0.0) discard;`)
      fragment = patchShader(fragment, alpha, 'finalPointAlpha = candidateSourceAlpha;')
      fragment = patchShader(fragment, 'finalPointAlpha *= greyoutOpacity;', 'finalPointAlpha = candidateSourceAlpha;')
    } else if (alphaPolicy === 'eligibility') {
      // Only the ID pass uses the source byte. Leave color alpha and blending
      // exactly as in the explicit control, including faint-source accumulation.
      fragment = patchShader(fragment, 'void main()', `${SOURCE_ALPHA_GLSL}\nvoid main()`)
      fragment = patchShader(fragment, picking, `${picking}\nif (quantizeSourceAlpha(max(finalShapeColor.a, finalImageColor.a) *
          (isGreyedOut > 0.0 && greyoutOpacity != -1.0 ? greyoutOpacity : pointOpacity)) <= 0.0) discard;`)
    }
    if (alphaPolicy !== 'unchanged') fragment = patchShader(fragment, '|| imageCovered;', '|| (imageCovered && finalImageColor.a > 0.0);')
  }
  if (clampTile) {
    const uv = 'vec2 atlasUV = mix(imageAtlasUV.xy, imageAtlasUV.zw, (imageCoord + 1.0) * 0.5);'
    fragment = patchShader(fragment, uv, `${uv}
      vec2 halfTexel = vec2(0.5) / vec2(textureSize(imageAtlasTexture, 0));
      atlasUV = clamp(atlasUV, imageAtlasUV.xy + halfTexel, imageAtlasUV.zw - halfTexel);`, 2)
  }
  if (texel) {
    vertex = patchShader(vertex, 'void main()', 'in vec4 sourceTexelRect;\nflat out vec4 diagnosticTexelRect;\nvoid main()')
    vertex = patchShader(vertex, position, `diagnosticTexelRect = sourceTexelRect;\n${position}`)
    fragment = patchShader(fragment, 'void main()', `flat in vec4 diagnosticTexelRect;
      vec4 sampleSourceTexel(vec2 offset, float diameter) {
        ivec2 origin = ivec2(diagnosticTexelRect.xy);
        ivec2 dimensions = ivec2(diagnosticTexelRect.zw);
        vec2 numerator = (offset + vec2(diameter * 0.5)) * vec2(dimensions);
        ivec2 pixel = clamp(ivec2(floor(numerator / diameter)), ivec2(0), dimensions - ivec2(1));
        return texelFetch(imageAtlasTexture, origin + pixel, 0);
      }
      void main()`)
    const begin = fragment.indexOf('    // Handle image rendering with centering logic')
    const end = fragment.indexOf('    // Host picking:', begin)
    if (begin < 0 || end < 0) throw new Error('Production image block changed')
    fragment = `${fragment.slice(0, begin)}
      if (imageAtlasUV.x != -1.0 && imageSizeVarying > 0.0) {
        vec2 offset = (gl_FragCoord.xy - diagnosticCenter) * vec2(1.0, -1.0);
        if (all(lessThanEqual(abs(offset), vec2(imageSizeVarying * 0.5)))) {
          finalImageColor = applyGreyoutToImage(sampleSourceTexel(offset, imageSizeVarying), isGreyedOut);
          imageCovered = true;
        }
      }
    ${fragment.slice(end)}`
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

export type StylingWebGL = Backend & {
  readSpriteCoordinates(points: Point[], settings: Settings, x: number, y: number): Promise<Float32Array>;
}

export async function createStylingWebGL (canvas: HTMLCanvasElement, gutterExtent = GUTTER_SIZE, timestamps = false): Promise<StylingWebGL> {
  const device = await createDevice('webgl', canvas, timestamps); const scope = resourceScope()
  try {
    const dynamic = scope.own(createDynamicAtlas(device))
    const atlases = {
      original: { nearest: scope.own(atlasTexture(device, 'nearest')), linear: scope.own(atlasTexture(device, 'linear')) },
      gutter: {
        nearest: scope.own(atlasTexture(device, 'nearest', true, gutterExtent)),
        linear: scope.own(atlasTexture(device, 'linear', true, gutterExtent)),
      },
    }
    const packedTextures = new Map<string, ReturnType<typeof atlasTexture>>()
    const packedTexture = (packing: NonNullable<import('./data').Settings['atlasPacking']>, gutter: boolean, filter: 'nearest' | 'linear'):
    ReturnType<typeof atlasTexture> => {
      const key = `${packing}:${gutter}:${filter}`; let texture = packedTextures.get(key)
      if (!texture) { texture = scope.own(atlasTexture(device, filter, gutter, gutterExtent, packing)); packedTextures.set(key, texture) }
      return texture
    }

    const uniforms = scope.own(new UniformStore(device, {
      drawVertexUniforms: { uniformTypes: vertexTypes }, drawFragmentUniforms: { uniformTypes: fragmentTypes },
    }))
    const attributes = [
      ['pointIndices', 'float32x2'], ['sourceSize', 'float32'], ['targetSize', 'float32'],
      ['sourceColor', 'float32x4'], ['targetColor', 'float32x4'], ['shape', 'float32'],
      ['imageIndex', 'float32'], ['imageSize', 'float32'], ['renderRank', 'float32'], ['pointRingColor', 'float32x4'],
      ['sourceStrokeColor', 'float32x4'], ['targetStrokeColor', 'float32x4'],
      ['sourceStrokeWidth', 'float32'], ['targetStrokeWidth', 'float32'],
    ] as const
    const models: Array<{ model: Model; quads: boolean; texel: boolean }> = []
    const make = (picking: boolean, fragment = fs, vertex = vs, quads = false, texel = false): Model => {
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
          POINT_RING_COLORS: true,
          ...({
            EXIT_DEFAULT_SIZE: '0.0', EXIT_DEFAULT_COLOR_CHANNEL: '0.0', EDGE_RAMP_PX: '1.0', POINT_RING_SCALE: '1.3',
          } as unknown as Record<string, boolean>),
        },
        bufferLayout: [...attributes.map(([name, format]) => ({ name, format, stepMode: quads ? 'instance' as const : 'vertex' as const })),
          ...(texel ? [{ name: 'sourceTexelRect', format: 'float32x4' as const, stepMode: 'instance' as const }] : [])],
        bindings: {
          drawVertexUniforms: uniforms.getManagedUniformBuffer('drawVertexUniforms'),
          drawFragmentUniforms: uniforms.getManagedUniformBuffer('drawFragmentUniforms'),
        },
        parameters: { ...(picking ? { blend: false } : ALPHA_BLEND), depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none' },
      }))
      models.push({ model, quads, texel }); return model
    }
    const visible = make(false); const picking = make(true)
    let diagnostic: Model | undefined
    const overlays = new Map<boolean, ReturnType<typeof createPointOverlays>>()
    let analyticColor: Model | undefined; let analyticPick: Model | undefined
    const candidates = new Map<string, { color: Model; pick: Model; probe: Model }>()
    /* eslint-disable no-redeclare -- The offscreen coordinate read and normal render return different types. */
    function renderFrame (points: Point[], settings: Settings, sample: { x: number; y: number }): Promise<Float32Array>
    function renderFrame (...args: Parameters<Backend['render']>): Promise<Snapshot>
    async function renderFrame (
      points: Point[], settings: Settings, diagnose: boolean | { x: number; y: number } = false,
      variant: RenderVariant = 'production', display = typeof diagnose === 'boolean', storedAlpha?: StoredAlphaOptions
    ): Promise<Snapshot | Float32Array> {
      /* eslint-enable no-redeclare */
      if (storedAlpha) validateStoredAlpha(points, settings, variant, storedAlpha)
      const frame = resourceScope()
      try {
        const isolation = variant === 'production' ? 'original' : settings.atlasIsolation ?? 'original'
        const packing = settings.atlasPacking ?? 'baseline'; const source = dynamic.layout
        if (source && !['original', 'clamp', 'texel'].includes(isolation)) throw new Error('Dynamic study uses original, clamped or source-texel sampling')
        const info = source ? { imageCount: source.images.length, coordsSize: source.coordsSize } : atlasInfo(packing)
        const [width, height] = dimensions(settings)
        if (display) { canvas.width = width; canvas.height = height; device.canvasContext!.resize({ width, height }) }
        const size = Math.max(1, Math.ceil(Math.sqrt(points.length))); const positions = new Float32Array(size * size * 4)
        const absent = positions.slice()
        points.forEach((p, i) => { positions.set([p.x - WIDTH / 2, HEIGHT / 2 - p.y, 0, 0], i * 4); absent[i * 4 + 1] = p.absent ? 1 : 0 })
        const texture = (data: Float32Array, width = size): Texture => {
          const result = frame.own(device.createTexture({
            width,
            height: width,
            format: 'rgba32float',
            usage: Texture.SAMPLE | Texture.COPY_DST,
            sampler: { minFilter: 'nearest', magFilter: 'nearest' },
          }))
          result.copyImageData({ data, bytesPerRow: width * 16 }); return result
        }
        const status = new Float32Array(positions.length)
        points.forEach((p, id) => { status[id * 4] = Number(greyed(p, settings)); status[id * 4 + 1] = Number(!!p.outlined) })
        const statusTexture = texture(status)
        const bindings = {
          positionsTexture: texture(positions),
          exitTexture: texture(absent),
          pointStatus: statusTexture,
          imageAtlasCoords: texture(source?.coords ?? atlasCoords(isolation, gutterExtent, packing), info.coordsSize),
          imageAtlasTexture: source
            ? dynamic.texture(settings.imageFilter ?? 'nearest')
            : packing === 'baseline'
              ? atlases[isolation === 'gutter' ? 'gutter' : 'original'][settings.imageFilter ?? 'nearest']
              : packedTexture(packing, isolation === 'gutter', settings.imageFilter ?? 'nearest'),
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
            case 'imageIndex': return [p.image ?? -1]
            case 'imageSize': return [p.imageSize ?? p.size]
            case 'renderRank': return [rank]
            case 'pointRingColor': return p.ringColor ?? [NaN, NaN, NaN, NaN]
            case 'sourceStrokeWidth': case 'targetStrokeWidth': return [p.stroke]
            default: return p.strokeColor
            }
          })
          records[name] = frame.own(device.createBuffer({ data: new Float32Array(values.length ? values : [0, 0, 0, 0]) }))
        }
        const texel = isolation === 'texel' && (settings.imageFilter ?? 'nearest') === 'nearest'
        const clamped = isolation === 'clamp' || (isolation === 'texel' && !texel)
        const key = `${variant}:${clamped}:${texel}:${settings.polygonArithmetic}`
        if (variant !== 'production' && !candidates.has(key)) {
          const policy = variant === 'explicit' ? 'unchanged' : variant
          const { vertex, fragment } = coordinateSources(true, policy, clamped, texel, settings.polygonArithmetic === 'pixels')
          candidates.set(key, {
            color: make(false, fragment, vertex, true, texel),
            pick: make(true, fragment, vertex, true, texel),
            probe: make(true, instrumentCoverage(fragment), vertex, true, texel),
          })
        }
        const candidate = candidates.get(key)
        if (diagnose && variant === 'production') diagnostic ??= make(true, instrumentCoverage(fs))
        if (diagnose === true && variant === 'production' && !analyticPick) {
          const { vertex, fragment } = coordinateSources(false)
          analyticColor ??= make(false, fragment, vertex); analyticPick = make(true, fragment, vertex)
        }
        let rectangleBuffer: Buffer | undefined
        if (models.some(model => model.texel)) {
          const rectangles = source ? new Uint32Array(source.rects.flatMap(r => [r.x, r.y, r.width, r.height])) : sourceTexelRects(packing)
          const data = new Float32Array(Math.max(4, points.length * 4))
          order.forEach((id, index) => {
            const image = points[id].image ?? -1
            if (image >= 0 && image < info.imageCount) data.set(rectangles.subarray(image * 4, image * 4 + 4), index * 4)
          })
          rectangleBuffer = frame.own(device.createBuffer({ data }))
        }
        for (const { model, quads, texel: needsRectangles } of models) {
          model.setAttributes(records)
          if (needsRectangles) model.setAttributes({ sourceTexelRect: rectangleBuffer! })
          model.setBindings(bindings); model.setVertexCount(quads ? 6 : points.length)
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
            greyoutColor: settings.greyoutColor ?? [-1, -1, -1, -1],
            backgroundColor: settings.backgroundColor ?? [0, 0, 0, 0],
            scalePointsOnZoom: Number(settings.scaleOnZoom),
            maxPointSize: settings.maxSize,
            isDarkenGreyout: Number(settings.darkenGreyout !== false),
            skipHighlighted: 0,
            skipGreyed: 0,
            hasImages: Number(points.some(p => p.image !== undefined && p.image >= 0 && p.image < info.imageCount)),
            imageCount: info.imageCount,
            imageAtlasCoordsTextureSize: info.coordsSize,
            transitionProgress: 1,
            animateColors: 0,
            animateSizes: 0,
            animatePositions: 0,
            pointDefaultColor: settings.defaultColor,
            pointDefaultSize: settings.defaultSize,
            pointsNumber: points.length,
            strokeContrast: settings.strokeContrast ?? 0,
            strokeDefaultShade: settings.strokeShade ?? 2,
            strokeDefaultWidth: settings.defaultStroke,
            strokeDefaultColor: settings.defaultStrokeColor,
            animateStrokeColors: 0,
            animateStrokeWidths: 0,
            ringDefaultColor: settings.ringColor ?? [1, 1, 1, 1],
            ringDefaultShade: settings.ringShade ?? 2,
            ringContrast: settings.ringContrast ?? 0,
          },
        })
        const draw = (model: Model, mode: number, framebuffer?: ReturnType<typeof target>['framebuffer'], rank?: number,
          timer?: StoredAlphaPassTimer): void => {
          uniforms.setUniforms({
            drawFragmentUniforms: {
              greyoutOpacity: settings.greyoutOpacity ?? -1,
              pointOpacity: settings.opacity,
              isDarkenGreyout: Number(settings.darkenGreyout !== false),
              backgroundColor: settings.backgroundColor ?? [0, 0, 0, 0],
              outlineWidth: 0.9,
              renderMode: mode,
              pickingAlpha: 1,
              pickingIndexOffset: 0,
            },
          })
          if (rank !== undefined) {
            const byteOffsets = Object.fromEntries(attributes.map(([name, format]) => [name, rank * 4 * Number(format.split('x')[1] ?? 1)]))
            model.setAttributes(records, { byteOffsets }); model.setInstanceCount(1)
            if (texel) model.setAttributes({ sourceTexelRect: rectangleBuffer! }, { byteOffsets: { sourceTexelRect: rank * 16 } })
          }
          const passProps = {
            framebuffer,
            clearColor: (framebuffer ? [0, 0, 0, 0] : settings.backgroundColor ?? [0.14, 0.16, 0.185, 1]) as [number, number, number, number],
            clearDepth: false as const,
          }
          const pass = timer ? timer.begin(passProps, mode === 0 ? 'paint' : 'geometry') : device.beginRenderPass(passProps)
          try {
            if (rank !== undefined) pass.setParameters({ scissorRect: regionScissor(device, height, storedAlpha!.region) })
            for (const layer of settings.highlighting ? [0, 1] : [-1]) {
              uniforms.setUniforms({ drawVertexUniforms: { skipHighlighted: Number(layer === 0), skipGreyed: Number(layer === 1) } })
              model.draw(pass)
            }
            if (rank === undefined && mode === 0 && overlayIndices(settings, points.length).length) {
              const pixelDistance = variant !== 'production' && settings.overlayArithmetic === 'pixels'
              let overlay = overlays.get(pixelDistance)
              if (!overlay) { overlay = scope.own(createPointOverlays(device, pixelDistance)); overlays.set(pixelDistance, overlay) }
              overlay.draw(pass, bindings, points, { ...settings, atlasSource: source })
            }
          } finally {
            if (timer) timer.end(pass); else pass.end()
            if (rank !== undefined) {
              model.setAttributes(records); model.setInstanceCount(points.length)
              if (texel) model.setAttributes({ sourceTexelRect: rectangleBuffer! })
            }
          }
        }
        if (typeof diagnose === 'object') {
          const geometry = frame.own(target(device, width, height, 'rgba32float'))
          draw(diagnostic!, 4, geometry.framebuffer)
          device.submit()
          // The inspector counts rows from the top. WebGL reads from the bottom.
          const sample = device.readPixelsToArrayWebGL(geometry.framebuffer, {
            sourceX: diagnose.x, sourceY: height - 1 - diagnose.y, sourceWidth: 2, sourceHeight: 1,
          })
          if (!(sample instanceof Float32Array) || device.isLost) throw new Error('WebGL sprite coordinates unavailable')
          return sample
        }
        const color = frame.own(target(device, width, height)); const ids = frame.own(target(device, width, height))
        const colorModel = candidate?.color ?? visible
        const pickModel = candidate?.pick ?? picking
        draw(colorModel, 0, color.framebuffer); draw(pickModel, 3, ids.framebuffer)
        if (display) draw(colorModel, 0)
        device.submit()
        let storedRanks: Map<number, number> | undefined
        const stored = storedAlpha
          ? await resolveStoredAlpha(device, width, height, points, settings, storedAlpha,
            (id, mask, geometry, timer) => {
              // The candidate retains original IDs; filtering never repacks the draw records.
              if (storedAlpha.candidate === 'filtered' && !storedRanks) storedRanks = new Map(order.map((id, rank) => [id, rank]))
              const rank = storedRanks ? storedRanks.get(id)! : order.indexOf(id)
              draw(colorModel, 0, mask, rank, timer); draw(pickModel, 3, geometry, rank, timer)
            }, ids)
          : undefined
        const readbackStart = performance.now()
        const result: Snapshot = {
          storedAlpha: stored,
          overlayArithmetic: variant === 'production' ? 'normalized' : settings.overlayArithmetic ?? 'normalized',
          polygonArithmetic: variant === 'production' ? 'normalized' : settings.polygonArithmetic ?? 'normalized',
          atlasSource: source,
          atlasGeneration: source ? dynamic.generation : undefined,
          atlasPacking: packing,
          atlasIsolation: isolation,
          atlasGutterExtent: isolation === 'gutter' ? gutterExtent : undefined,
          pickingRule: stored ? 'stored-alpha' : variant === 'production' ? 'legacy' : variant === 'explicit' ? 'visible' : 'source-alpha',
          width,
          height,
          color: await pixels(device, color.texture, color.framebuffer),
          ids: await pixels(device, ids.texture, ids.framebuffer),
        }
        if (stored?.timing) stored.timing.frameReadbackWallMs = performance.now() - readbackStart
        if (diagnose) {
          const geometry = frame.own(target(device, width, height, 'rgba32float'))
          const edge = frame.own(target(device, width, height, 'rgba32float'))
          const probe = candidate?.probe ?? diagnostic!
          draw(probe, 4, geometry.framebuffer); draw(probe, 5, edge.framebuffer); device.submit()
          result.probe = {
            geometry: await floatPixels(device, geometry.texture, geometry.framebuffer), edge: await floatPixels(device, edge.texture, edge.framebuffer),
          }
        }
        if (diagnose && variant === 'production') {
          const analytic = frame.own(target(device, width, height)); const analyticIds = frame.own(target(device, width, height))
          draw(analyticColor!, 0, analytic.framebuffer); draw(analyticPick!, 3, analyticIds.framebuffer); device.submit()
          result.analyticControl = {
            atlasPacking: packing,
            atlasIsolation: 'original',
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
    }
    return {
      atlas: dynamic,
      info: describeDevice(device),
      render: renderFrame,
      readSpriteCoordinates: (points, settings, x, y) => renderFrame(points, settings, { x, y }),
      destroy (): void { try { scope.destroy() } finally { device.destroy() } },
    }
  } catch (error) { try { scope.destroy() } finally { device.destroy() }; throw error }
}
