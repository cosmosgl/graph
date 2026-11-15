import { Buffer, type TextureFormatColor } from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/engine'
import { ALPHA_BLEND, bindingLayout, createDevice, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { dimensions, floatPixels, pixels, target, type Backend, type Snapshot } from './backend'
import { HEIGHT, resolvePoint, WIDTH } from './data'
import source from './points.wgsl?raw'
import effects from './effects.wgsl?raw'
import { greyed, overlayIndices } from './point-effects'
import { SOURCE_ALPHA_WGSL } from './source-alpha'
import { atlasTexture, atlasCoords, atlasInfo, GUTTER_SIZE, sourceTexelRects } from './atlas'
import { createDynamicAtlas } from './dynamic-atlas'

export async function createStylingWebGPU (canvas: HTMLCanvasElement, gutterExtent = GUTTER_SIZE): Promise<Backend> {
  let failure: string | undefined
  const device = await createDevice('webgpu', canvas, false, error => { failure ??= error.message; return true })
  const scope = resourceScope()
  try {
    const dynamic = scope.own(createDynamicAtlas(device))
    const shaderLayout = {
      attributes: [],
      bindings: [...bindingLayout([['points', 'read-only-storage'], ['params', 'uniform']]),
        { name: 'atlas', type: 'texture' as const, location: 2, group: 0, sampleType: 'float' as const, viewDimension: '2d' as const },
        { name: 'atlasSampler', type: 'sampler' as const, location: 3, group: 0, samplerType: 'filtering' as const },
        { name: 'imageRects', type: 'read-only-storage' as const, location: 4, group: 0 }],
    }
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

    const rectangleBuffers = new Map<string, ReturnType<typeof upload>>()
    const vertexArray = scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] }))
    const make = (format: TextureFormatColor, picking: boolean, display = false, overlay = false): RenderKernel => scope.own(new RenderKernel(device, {
      vertexSource: `${source}\n${SOURCE_ALPHA_WGSL}\n${effects}`,
      fragmentSource: `${source}\n${SOURCE_ALPHA_WGSL}\n${effects}`,
      vertexEntryPoint: overlay ? 'overlayVertex' : 'vertexMain',
      fragmentEntryPoint: overlay ? 'overlayFragment' : 'fragmentMain',
      topology: 'triangle-list',
      shaderLayout,
      colorAttachmentFormats: [format],
      depthStencilAttachmentFormat: display ? device.canvasContext!.getCurrentFramebuffer().depthStencilAttachment?.texture.format as 'depth24plus' : undefined,
      parameters: {
        ...(picking ? { blend: false } : ALPHA_BLEND),
        ...(display ? { depthWriteEnabled: false, depthCompare: 'always' as const } : {}),
        cullMode: 'none',
      },
    }))
    const colorKernel = make('rgba8unorm', false); const pickKernel = make('rgba8unorm', true)
    let diagnostic: RenderKernel | undefined; let overlayKernel: RenderKernel | undefined; let overlayDisplay: RenderKernel | undefined
    const displayKernel = make(device.canvasContext!.getCurrentFramebuffer().colorAttachments[0].texture.format as TextureFormatColor, false, true)
    return {
      atlas: dynamic,
      info: `${String(device.info.vendor)} / ${String(device.info.renderer)}`,
      async render (points, settings, diagnose = false, variant = 'production', display = true): Promise<Snapshot> {
        const frame = resourceScope()
        try {
          const isolation = variant === 'production' ? 'original' : settings.atlasIsolation ?? 'original'
          const packing = settings.atlasPacking ?? 'baseline'; const atlasSource = dynamic.layout
          if (atlasSource && !['original', 'clamp', 'texel'].includes(isolation)) {
            throw new Error('Dynamic study uses original, clamped or source-texel sampling')
          }
          const info = atlasSource ? { imageCount: atlasSource.images.length, coordsSize: atlasSource.coordsSize } : atlasInfo(packing)
          const coords = atlasSource?.coords ?? atlasCoords(isolation, gutterExtent, packing)
          let imageRects = atlasSource
            ? frame.own(upload(device, new Uint32Array(atlasSource.rects.length
              ? atlasSource.rects.flatMap(r => [r.x, r.y, r.width, r.height])
              : [0, 0, 0, 0])))
            : rectangleBuffers.get(packing)
          if (!imageRects) { imageRects = scope.own(upload(device, sourceTexelRects(packing))); rectangleBuffers.set(packing, imageRects) }
          const texel = isolation === 'texel' && (settings.imageFilter ?? 'nearest') === 'nearest'
          const samplerMode = texel ? 2 : Number(isolation === 'clamp' || isolation === 'texel')
          const [width, height] = dimensions(settings)
          if (display) { canvas.width = width; canvas.height = height; device.canvasContext!.resize({ width, height }) }
          const color = frame.own(target(device, width, height)); const ids = frame.own(target(device, width, height))
          const order = points.map((_, id) => id); if (settings.reverse) order.reverse()
          const records = new Float32Array(Math.max(32, points.length * 32))
          order.forEach((id, index) => {
            const p = resolvePoint(points[id], settings)
            const image = p.image ?? -1; const hasImage = image >= 0 && image < info.imageCount
            records.set([p.x, p.y, p.size, p.shape, ...p.color, ...p.strokeColor, p.stroke, Number(!!p.absent), id, 0,
              image, p.imageSize ?? p.size, Number(hasImage), 0,
              ...(hasImage ? coords.subarray(image * 4, image * 4 + 4) : [-1, -1, -1, -1]),
              ...(p.ringColor?.every(Number.isFinite) ? p.ringColor : settings.ringColor ?? [1, 1, 1, 1]),
              Number(greyed(p, settings)), Number(!!p.outlined), Number(!!p.ringColor?.every(Number.isFinite)),
              Number(points[id].strokeColor.some(Number.isNaN))], index * 32)
          })
          const buffer = frame.own(upload(device, records))
          const params = (mode: number, layer = -1, overlayIndex = 0, overlayColor?: number[]): ReturnType<typeof upload> =>
            frame.own(upload(device, new Float32Array([
              WIDTH, HEIGHT, settings.ratio, settings.zoom, settings.sizeScale, settings.maxSize, settings.opacity, samplerMode,
              Number(settings.scaleOnZoom), mode, Number(variant !== 'production'), variant === 'eligibility' ? 2 : Number(variant === 'quantized'),
              ...(settings.greyoutColor ?? [-1, -1, -1, -1]), ...(settings.backgroundColor ?? [0, 0, 0, 0]),
              ...(overlayColor ?? settings.ringColor ?? [1, 1, 1, 1]),
              settings.greyoutOpacity ?? -1, Number(settings.darkenGreyout !== false), settings.strokeContrast ?? 0, settings.ringContrast ?? 0,
              settings.strokeShade ?? 2, settings.ringShade ?? 2, layer, overlayIndex,
            ]), Buffer.UNIFORM))
          const draw = (kernel: RenderKernel, mode: number, framebuffer?: ReturnType<typeof target>['framebuffer']): void => {
            const pass = device.beginRenderPass({
              framebuffer,
              clearColor: framebuffer ? [0, 0, 0, 0] : settings.backgroundColor ?? [0.14, 0.16, 0.185, 1],
              clearDepth: false,
            })
            try {
              const atlas = atlasSource
                ? dynamic.texture(settings.imageFilter ?? 'nearest')
                : packing === 'baseline'
                  ? atlases[isolation === 'gutter' ? 'gutter' : 'original'][settings.imageFilter ?? 'nearest']
                  : packedTexture(packing, isolation === 'gutter', settings.imageFilter ?? 'nearest')
              for (const layer of settings.highlighting ? [0, 1] : [-1]) {
                kernel.draw(pass, {
                  vertexArray,
                  vertexCount: 6,
                  instanceCount: points.length,
                  bindings: { points: buffer, params: params(mode, layer), atlas, imageRects },
                })
              }
              if (mode === 0) {
                for (const ring of overlayIndices(settings, points.length)) {
                  overlayKernel ??= make('rgba8unorm', false, false, true)
                  if (!framebuffer) {
                    overlayDisplay ??= make(device.canvasContext!.getCurrentFramebuffer().colorAttachments[0].texture.format as TextureFormatColor,
                      false, true, true)
                  }
                  const overlay = framebuffer ? overlayKernel : overlayDisplay!
                  overlay.draw(pass, {
                    vertexArray,
                    vertexCount: 6,
                    instanceCount: 1,
                    bindings: { points: buffer, params: params(0, -1, order.indexOf(ring.index), ring.color), atlas, imageRects },
                  })
                }
              }
            } finally { pass.end() }
          }
          draw(colorKernel, 0, color.framebuffer); draw(pickKernel, 1, ids.framebuffer)
          if (display) draw(displayKernel, 0)
          device.submit()
          const result: Snapshot = {
            atlasSource,
            atlasGeneration: atlasSource ? dynamic.generation : undefined,
            atlasPacking: packing,
            atlasIsolation: isolation,
            atlasGutterExtent: isolation === 'gutter' ? gutterExtent : undefined,
            pickingRule: variant === 'production' ? 'legacy' : variant === 'explicit' ? 'visible' : 'source-alpha',
            width,
            height,
            color: await pixels(device, color.texture, color.framebuffer),
            ids: await pixels(device, ids.texture, ids.framebuffer),
          }
          if (diagnose) {
            diagnostic ??= make('rgba32float', true)
            const geometry = frame.own(target(device, width, height, 'rgba32float'))
            const edge = frame.own(target(device, width, height, 'rgba32float'))
            draw(diagnostic, 2, geometry.framebuffer); draw(diagnostic, 3, edge.framebuffer); device.submit()
            result.probe = {
              geometry: await floatPixels(device, geometry.texture, geometry.framebuffer), edge: await floatPixels(device, edge.texture, edge.framebuffer),
            }
          }
          if (failure || device.isLost) throw new Error(failure ?? 'WebGPU device lost')
          return result
        } finally { frame.destroy() }
      },
      destroy (): void { try { scope.destroy() } finally { device.destroy() } },
    }
  } catch (error) { try { scope.destroy() } finally { device.destroy() }; throw error }
}
