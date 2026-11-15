import { Texture, UniformStore, type Buffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import vertex from '../../../../../src/modules/Lines/draw-curve-line.vert?raw'
import fragment from '../../../../../src/modules/Lines/draw-curve-line.frag?raw'
import conic from '../../../../../src/modules/Lines/conic-curve-module.ts?raw'
import picking from '../../../../../src/modules/Shared/picking-color-module.ts?raw'
import { ALPHA_BLEND, createDevice } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { target, pixels } from '../../gpu/rgba-readback'
import { SOURCE_ALPHA_GLSL } from '../../gpu/source-alpha'
import { WIDTH, HEIGHT } from './data'
import type { Backend, Snapshot } from './backend'
const vertexTypes = {
  transformationMatrix: 'mat4x4<f32>',
  widthScale: 'f32',
  linkArrowsSizeScale: 'f32',
  worldOrigin: 'vec2<f32>',
  screenSize: 'vec2<f32>',
  linkVisibilityDistanceRange: 'vec2<f32>',
  linkVisibilityMinTransparency: 'f32',
  linkOpacity: 'f32',
  greyoutOpacity: 'f32',
  curvedWeight: 'f32',
  curvedLinkControlPointDistance: 'f32',
  curvedLinkSegments: 'f32',
  scaleLinksOnZoom: 'f32',
  maxPointSize: 'f32',
  renderMode: 'f32',
  hoveredLinkIndex: 'f32',
  hoveredLinkWidthIncrease: 'f32',
  isLinkHighlightingActive: 'f32',
  linkStatusTextureSize: 'f32',
  focusedLinkIndex: 'f32',
  focusedLinkWidthIncrease: 'f32',
  transitionProgress: 'f32',
  animateColors: 'f32',
  animateWidths: 'f32',
  animatePositions: 'f32',
  pointDefaultColor: 'vec4<f32>',
  linkDefaultColor: 'vec4<f32>',
  linkDefaultWidth: 'f32',
  linkColorInterpolateFromEndpoints: 'f32',
  linkBlending: 'f32',
  pixelRatio: 'f32',
} as const
const fragmentTypes = {
  renderMode: 'f32',
  linkDashLength: 'f32',
  linkDashGap: 'f32',
  linkColorInterpolateFromEndpoints: 'f32',
  hoveredLinkIndex: 'f32',
  hoveredLinkColor: 'vec4<f32>',
  linkBlending: 'f32',
  pickingAlpha: 'f32',
  pickingIndexOffset: 'f32',
} as const
function moduleSource (text: string): string {
  const match = text.match(/\/\* glsl \*\/\s*`([^`]+)`/)
  if (!match || match[1].includes('${')) throw new Error('Unsupported production module source')
  return match[1]
}
const widthPadding = 'linkWidthPx += 5.0 / transformationMatrix[0][0];'
const pickBranch = 'if (coverage < 0.5 || rgbaColor.a <= 0.0) discard;'
if (!vertex.includes(widthPadding) || !fragment.includes(pickBranch)) throw new Error('Production link candidate patch location changed')
const visibleVertex = vertex.replace(widthPadding, '/* Candidate: host ID ribbon uses the visible width. */')
  .replace('void main()', 'flat out vec4 diagnosticRibbon;\nflat out float diagnosticHalf;\nvoid main()')
  .replace('linkWidthPx = max(linkWidthPx, minWidthPx) + smoothingPx;',
    `diagnosticRibbon = vec4((a - worldOrigin) * transformationMatrix[0][0] * pixelRatio + screenSize * pixelRatio * 0.5, yBasis);
     diagnosticHalf = max(linkWidthPx,minWidthPx) * transformationMatrix[0][0] * pixelRatio * 0.5;
     linkWidthPx = max(linkWidthPx, minWidthPx) + smoothingPx;`)
const visibleFragment = fragment.replace('void main()',
  `flat in vec4 diagnosticRibbon;\nflat in float diagnosticHalf;\n${SOURCE_ALPHA_GLSL}\nvoid main()`)
  .replace(pickBranch,
    `if (abs(dot(gl_FragCoord.xy - diagnosticRibbon.xy,diagnosticRibbon.zw)) > diagnosticHalf || rgbaColor.a <= 0.0) discard;
     if (linkBlending > 0.5 && quantizeSourceAlpha(opacity) <= 0.0) discard;
     if (linkBlending < 0.5 && coverage < 0.5) discard;`)
export async function createLinksWebGL (canvas: HTMLCanvasElement): Promise<Backend> {
  const device = await createDevice('webgl', canvas, false); const scope = resourceScope()
  try {
    const uniforms = scope.own(new UniformStore(device, {
      drawLineUniforms: { uniformTypes: vertexTypes }, drawLineFragmentUniforms: { uniformTypes: fragmentTypes },
    }))
    const geometry = scope.own(device.createBuffer({ data: new Float32Array([0, 0.5, 0, -0.5, 1, 0.5, 1, -0.5]) }))
    const attributes = [['pointA', 'float32x2'], ['pointB', 'float32x2'], ['sourceColor', 'float32x4'], ['targetColor', 'float32x4'],
      ['sourceWidth', 'float32'], ['targetWidth', 'float32'], ['arrow', 'float32'], ['linkIndices', 'float32'], ['linkStyle', 'float32']] as const
    const models = new Map<string, Model>()
    const make = (blend: boolean, candidate: boolean, isPicking: boolean): Model => {
      const key = `${blend}:${candidate}:${isPicking}`; const cached = models.get(key); if (cached) return cached
      const model = scope.own(new Model(device, {
        vs: candidate ? visibleVertex : vertex,
        fs: candidate ? visibleFragment : fragment,
        modules: [{ name: 'conicParametricCurve', vs: moduleSource(conic) }, { name: 'pickingColor', fs: moduleSource(picking) }],
        topology: 'triangle-strip',
        vertexCount: 4,
        defines: { USE_UNIFORM_BUFFERS: true, ...({ EXIT_DEFAULT_COLOR_CHANNEL: '0.0', EDGE_RAMP_PX: '1.0' } as unknown as Record<string, boolean>) },
        bufferLayout: [{ name: 'position', format: 'float32x2' },
          ...attributes.map(([name, format]) => ({ name, format, stepMode: 'instance' as const }))],
        attributes: { position: geometry },
        bindings: {
          drawLineUniforms: uniforms.getManagedUniformBuffer('drawLineUniforms'),
          drawLineFragmentUniforms: uniforms.getManagedUniformBuffer('drawLineFragmentUniforms'),
        },
        parameters: { ...(blend ? ALPHA_BLEND : { blend: false }), depthWriteEnabled: false, depthCompare: 'always', cullMode: isPicking ? 'none' : 'back' },
      }))
      models.set(key, model); return model
    }
    return {
      info: `${String(device.info.vendor)} / ${String(device.info.renderer)}`,
      async render (scene, settings, variant, display = true): Promise<Snapshot> {
        const frame = resourceScope()
        try {
          const { points, links } = scene; const width = WIDTH * settings.ratio; const height = HEIGHT * settings.ratio
          if (display) { canvas.width = width; canvas.height = height; device.canvasContext!.resize({ width, height }) }
          const color = frame.own(target(device, width, height)); const ids = frame.own(target(device, width, height))
          const size = Math.max(1, Math.ceil(Math.sqrt(points.length))); const positions = new Float32Array(size * size * 4)
          const exits = positions.slice(); const pointColors = positions.slice()
          points.forEach((p, id) => {
            positions.set([p.absent ? NaN : p.x - WIDTH / 2, p.absent ? NaN : HEIGHT / 2 - p.y, 0, 0], id * 4)
            exits[id * 4 + 1] = Number(!!p.absent)
          })
          const texture = (data: Float32Array, dimension = size): Texture => {
            const result = frame.own(device.createTexture({
              width: dimension,
              height: dimension,
              format: 'rgba32float',
              usage: Texture.SAMPLE | Texture.COPY_DST,
              sampler: { minFilter: 'nearest', magFilter: 'nearest' },
            }))
            result.copyImageData({ data, bytesPerRow: dimension * 16 }); return result
          }
          const bindings = {
            positionsTexture: texture(positions),
            exitTexture: texture(exits),
            pointColorsTexture: texture(pointColors),
            linkStatus: texture(new Float32Array(4), 1),
          }
          const order = links.map((_, i) => i); if (settings.reverse) order.reverse()
          const buffers: Record<string, Buffer> = {}
          for (const [name] of attributes) {
            const data = order.flatMap(id => {
              const link = links[id]; const a = link.source; const b = link.target
              switch (name) {
              case 'pointA': return [a % size, Math.floor(a / size)]
              case 'pointB': return [b % size, Math.floor(b / size)]
              case 'sourceColor': case 'targetColor': return link.color
              case 'sourceWidth': case 'targetWidth': return [link.width]
              case 'linkIndices': return [id]
              default: return [0]
              }
            })
            buffers[name] = frame.own(device.createBuffer({ data: new Float32Array(data.length ? data : [0, 0, 0, 0]) }))
          }
          const draw = (mode: number, framebuffer?: ReturnType<typeof target>['framebuffer']): void => {
            // The color pass always uses the unmodified production shaders.
            const model = make(mode === 0 && settings.blend, mode > 0 && variant === 'visible', mode > 0)
            model.setAttributes(buffers); model.setBindings(bindings); model.setInstanceCount(links.length)
            uniforms.setUniforms({
              drawLineUniforms: {
                transformationMatrix: [settings.zoom, 0, 0, 0, 0, settings.zoom, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                widthScale: settings.widthScale,
                linkArrowsSizeScale: 1,
                worldOrigin: [0, 0],
                screenSize: [WIDTH, HEIGHT],
                linkVisibilityDistanceRange: [0, 1],
                linkVisibilityMinTransparency: 1,
                linkOpacity: settings.opacity,
                greyoutOpacity: 1,
                curvedWeight: 1,
                curvedLinkControlPointDistance: 0,
                curvedLinkSegments: 1,
                scaleLinksOnZoom: Number(settings.scaleOnZoom),
                maxPointSize: settings.maxWidth,
                renderMode: mode,
                hoveredLinkIndex: -1,
                hoveredLinkWidthIncrease: 0,
                isLinkHighlightingActive: 0,
                linkStatusTextureSize: 1,
                focusedLinkIndex: -1,
                focusedLinkWidthIncrease: 0,
                transitionProgress: 1,
                animateColors: 0,
                animateWidths: 0,
                animatePositions: 0,
                pointDefaultColor: [1, 1, 1, 1],
                linkDefaultColor: settings.defaultColor,
                linkDefaultWidth: settings.defaultWidth,
                linkColorInterpolateFromEndpoints: 0,
                linkBlending: Number(settings.blend),
                pixelRatio: settings.ratio,
              },
              drawLineFragmentUniforms: {
                renderMode: mode,
                linkDashLength: 5,
                linkDashGap: 5,
                linkColorInterpolateFromEndpoints: 0,
                hoveredLinkIndex: -1,
                hoveredLinkColor: [-1, -1, -1, -1],
                linkBlending: Number(settings.blend),
                pickingAlpha: 1,
                pickingIndexOffset: settings.indexOffset,
              },
            })
            const pass = device.beginRenderPass({ framebuffer, clearColor: framebuffer ? [0, 0, 0, 0] : [0.14, 0.16, 0.185, 1], clearDepth: false })
            try { model.draw(pass) } finally { pass.end() }
          }
          draw(0, color.framebuffer); draw(3, ids.framebuffer); if (display) draw(0)
          device.submit()
          return {
            variant,
            width,
            height,
            color: await pixels(device, color.texture, color.framebuffer),
            ids: await pixels(device, ids.texture, ids.framebuffer),
          }
        } finally { frame.destroy() }
      },
      destroy (): void { try { scope.destroy() } finally { device.destroy() } },
    }
  } catch (error) { try { scope.destroy() } finally { device.destroy() }; throw error }
}
