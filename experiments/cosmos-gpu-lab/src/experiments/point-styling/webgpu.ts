import { Buffer, type TextureFormatColor } from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/engine'
import { ALPHA_BLEND, bindingLayout, createDevice, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { dimensions, floatPixels, pixels, target, type Backend, type Snapshot } from './backend'
import { HEIGHT, resolvePoint, WIDTH } from './data'
import source from './points.wgsl?raw'
import { SOURCE_ALPHA_WGSL } from './source-alpha'

export async function createStylingWebGPU (canvas: HTMLCanvasElement): Promise<Backend> {
  let failure: string | undefined
  const device = await createDevice('webgpu', canvas, false, error => { failure ??= error.message; return true })
  const scope = resourceScope()
  try {
    const shaderLayout = { attributes: [], bindings: bindingLayout([['points', 'read-only-storage'], ['params', 'uniform']]) }
    const vertexArray = scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] }))
    const make = (format: TextureFormatColor, picking: boolean, display = false): RenderKernel => scope.own(new RenderKernel(device, {
      vertexSource: `${source}\n${SOURCE_ALPHA_WGSL}`,
      fragmentSource: `${source}\n${SOURCE_ALPHA_WGSL}`,
      vertexEntryPoint: 'vertexMain',
      fragmentEntryPoint: 'fragmentMain',
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
    let diagnostic: RenderKernel | undefined
    const displayKernel = make(device.canvasContext!.getCurrentFramebuffer().colorAttachments[0].texture.format as TextureFormatColor, false, true)
    return {
      info: `${String(device.info.vendor)} / ${String(device.info.renderer)}`,
      async render (points, settings, diagnose = false, variant = 'production', display = true): Promise<Snapshot> {
        const frame = resourceScope()
        try {
          const [width, height] = dimensions(settings)
          if (display) { canvas.width = width; canvas.height = height; device.canvasContext!.resize({ width, height }) }
          const color = frame.own(target(device, width, height)); const ids = frame.own(target(device, width, height))
          const order = points.map((_, id) => id); if (settings.reverse) order.reverse()
          const records = new Float32Array(Math.max(16, points.length * 16))
          order.forEach((id, index) => {
            const p = resolvePoint(points[id], settings)
            records.set([p.x, p.y, p.size, p.shape, ...p.color, ...p.strokeColor, p.stroke, Number(!!p.absent), id, 0], index * 16)
          })
          const buffer = frame.own(upload(device, records))
          const params = (mode: number): ReturnType<typeof upload> => frame.own(upload(device, new Float32Array([
            WIDTH, HEIGHT, settings.ratio, settings.zoom, settings.sizeScale, settings.maxSize, settings.opacity, 0,
            Number(settings.scaleOnZoom), mode, Number(variant !== 'production'), Number(variant === 'quantized'),
          ]), Buffer.UNIFORM))
          const visibleParams = params(0); const pickingParams = params(1)
          const draw = (kernel: RenderKernel, uniforms: ReturnType<typeof upload>, framebuffer?: ReturnType<typeof target>['framebuffer']): void => {
            const pass = device.beginRenderPass({ framebuffer, clearColor: framebuffer ? [0, 0, 0, 0] : [0.14, 0.16, 0.185, 1], clearDepth: false })
            try {
              kernel.draw(pass, { vertexArray, vertexCount: 6, instanceCount: points.length, bindings: { points: buffer, params: uniforms } })
            } finally { pass.end() }
          }
          draw(colorKernel, visibleParams, color.framebuffer); draw(pickKernel, pickingParams, ids.framebuffer)
          if (display) draw(displayKernel, visibleParams)
          device.submit()
          const result: Snapshot = {
            pickingRule: variant === 'quantized' ? 'source-alpha' : variant === 'explicit' ? 'visible' : 'legacy',
            width,
            height,
            color: await pixels(device, color.texture, color.framebuffer),
            ids: await pixels(device, ids.texture, ids.framebuffer),
          }
          if (diagnose) {
            diagnostic ??= make('rgba32float', true)
            const geometry = frame.own(target(device, width, height, 'rgba32float'))
            const edge = frame.own(target(device, width, height, 'rgba32float'))
            draw(diagnostic, params(2), geometry.framebuffer); draw(diagnostic, params(3), edge.framebuffer); device.submit()
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
