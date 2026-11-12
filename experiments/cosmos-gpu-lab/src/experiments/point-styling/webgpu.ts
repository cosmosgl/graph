import { Buffer, type TextureFormatColor } from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/engine'
import { ALPHA_BLEND, bindingLayout, createDevice, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { dimensions, pixels, target, type Backend, type Snapshot } from './backend'
import { HEIGHT, resolvePoint, WIDTH } from './data'
import source from './points.wgsl?raw'

export async function createStylingWebGPU (canvas: HTMLCanvasElement): Promise<Backend> {
  let failure: string | undefined
  const device = await createDevice('webgpu', canvas, false, error => { failure ??= error.message; return true })
  const scope = resourceScope()
  try {
    const shaderLayout = { attributes: [], bindings: bindingLayout([['points', 'read-only-storage'], ['params', 'uniform']]) }
    const vertexArray = scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] }))
    const make = (format: TextureFormatColor, picking: boolean, display = false): RenderKernel => scope.own(new RenderKernel(device, {
      vertexSource: source,
      fragmentSource: source,
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
    const displayKernel = make(device.canvasContext!.getCurrentFramebuffer().colorAttachments[0].texture.format as TextureFormatColor, false, true)
    return {
      info: `${String(device.info.vendor)} / ${String(device.info.renderer)}`,
      async render (points, settings): Promise<Snapshot> {
        const frame = resourceScope()
        try {
          const [width, height] = dimensions(settings); canvas.width = width; canvas.height = height
          device.canvasContext!.resize({ width, height })
          const color = frame.own(target(device, width, height)); const ids = frame.own(target(device, width, height))
          const order = points.map((_, id) => id); if (settings.reverse) order.reverse()
          const records = new Float32Array(Math.max(16, points.length * 16))
          order.forEach((id, index) => {
            const p = resolvePoint(points[id], settings)
            records.set([p.x, p.y, p.size, p.shape, ...p.color, ...p.strokeColor, p.stroke, Number(!!p.absent), id, 0], index * 16)
          })
          const buffer = frame.own(upload(device, records))
          const params = (picking: boolean): ReturnType<typeof upload> => frame.own(upload(device, new Float32Array([
            WIDTH, HEIGHT, settings.ratio, settings.zoom, settings.sizeScale, settings.maxSize, settings.opacity, 0,
            Number(settings.scaleOnZoom), Number(picking), 0, 0,
          ]), Buffer.UNIFORM))
          const visibleParams = params(false); const pickingParams = params(true)
          const draw = (kernel: RenderKernel, uniforms: ReturnType<typeof upload>, framebuffer?: ReturnType<typeof target>['framebuffer']): void => {
            const pass = device.beginRenderPass({ framebuffer, clearColor: framebuffer ? [0, 0, 0, 0] : [0.14, 0.16, 0.185, 1], clearDepth: false })
            try {
              kernel.draw(pass, { vertexArray, vertexCount: 6, instanceCount: points.length, bindings: { points: buffer, params: uniforms } })
            } finally { pass.end() }
          }
          draw(colorKernel, visibleParams, color.framebuffer); draw(pickKernel, pickingParams, ids.framebuffer); draw(displayKernel, visibleParams)
          device.submit()
          const result = {
            width,
            height,
            color: await pixels(device, color.texture, color.framebuffer),
            ids: await pixels(device, ids.texture, ids.framebuffer),
          }
          if (failure || device.isLost) throw new Error(failure ?? 'WebGPU device lost')
          return result
        } finally { frame.destroy() }
      },
      destroy (): void { try { scope.destroy() } finally { device.destroy() } },
    }
  } catch (error) { try { scope.destroy() } finally { device.destroy() }; throw error }
}
