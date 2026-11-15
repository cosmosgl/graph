import { Buffer, type TextureFormatColor } from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/engine'
import { ALPHA_BLEND, bindingLayout, createDevice, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { pixels, target } from '../../gpu/rgba-readback'
import { SOURCE_ALPHA_WGSL } from '../../gpu/source-alpha'
import source from './links.wgsl?raw'
import { HEIGHT, WIDTH, resolveLink } from './data'
import type { Backend, Snapshot } from './backend'
export async function createLinksWebGPU (canvas: HTMLCanvasElement): Promise<Backend> {
  let failure: string | undefined
  const device = await createDevice('webgpu', canvas, false, error => { failure ??= error.message; return true }); const scope = resourceScope()
  try {
    const shaderLayout = {
      attributes: [],
      bindings: bindingLayout([['positions', 'read-only-storage'], ['links', 'read-only-storage'], ['params', 'uniform']]),
    }
    const vertexArray = scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] }))
    const kernels = new Map<string, RenderKernel>()
    const kernel = (format: TextureFormatColor, blend: boolean, display: boolean, picking: boolean): RenderKernel => {
      const key = `${format}:${blend}:${display}:${picking}`; const cached = kernels.get(key); if (cached) return cached
      const result = scope.own(new RenderKernel(device, {
        vertexSource: `${source}\n${SOURCE_ALPHA_WGSL}`,
        fragmentSource: `${source}\n${SOURCE_ALPHA_WGSL}`,
        vertexEntryPoint: 'vertexMain',
        fragmentEntryPoint: 'fragmentMain',
        topology: 'triangle-strip',
        shaderLayout,
        colorAttachmentFormats: [format],
        depthStencilAttachmentFormat: display
          ? device.canvasContext!.getCurrentFramebuffer().depthStencilAttachment?.texture.format as 'depth24plus'
          : undefined,
        parameters: {
          ...(blend ? ALPHA_BLEND : { blend: false }),
          cullMode: picking ? 'none' : 'back',
          ...(display ? { depthWriteEnabled: false, depthCompare: 'always' as const } : {}),
        },
      }))
      kernels.set(key, result); return result
    }
    return {
      info: `${String(device.info.vendor)} / ${String(device.info.renderer)}`,
      async render (scene, settings, variant, display = true): Promise<Snapshot> {
        const frame = resourceScope()
        try {
          const width = WIDTH * settings.ratio; const height = HEIGHT * settings.ratio
          if (display) { canvas.width = width; canvas.height = height; device.canvasContext!.resize({ width, height }) }
          const color = frame.own(target(device, width, height)); const ids = frame.own(target(device, width, height))
          const positions = new Float32Array(Math.max(4, scene.points.length * 4))
          scene.points.forEach((p, i) => positions.set([p.x - WIDTH / 2, HEIGHT / 2 - p.y, Number(!!p.absent), 0], i * 4))
          const positionBuffer = frame.own(upload(device, positions))
          const order = scene.links.map((_, i) => i); if (settings.reverse) order.reverse()
          const storage = new ArrayBuffer(Math.max(48, scene.links.length * 48))
          const indices = new Uint32Array(storage); const values = new Float32Array(storage)
          order.forEach((id, row) => {
            const link = resolveLink(scene.links[id], settings); indices.set([link.source, link.target, id, 0], row * 12)
            values.set([...link.color, link.width, 0, 0, 0], row * 12 + 4)
          })
          const links = frame.own(upload(device, new Uint8Array(storage)))
          const draw = (mode: number, framebuffer?: ReturnType<typeof target>['framebuffer']): void => {
            const params = frame.own(upload(device, new Float32Array([WIDTH, HEIGHT, settings.zoom, settings.ratio,
              settings.widthScale, settings.maxWidth, settings.opacity, settings.indexOffset,
              Number(settings.scaleOnZoom), Number(settings.blend), mode, Number(variant === 'visible')]), Buffer.UNIFORM))
            const format = framebuffer ? 'rgba8unorm' : device.canvasContext!.getCurrentFramebuffer().colorAttachments[0].texture.format as TextureFormatColor
            const pass = device.beginRenderPass({ framebuffer, clearColor: framebuffer ? [0, 0, 0, 0] : [0.14, 0.16, 0.185, 1], clearDepth: false })
            try {
              kernel(format, mode === 0 && settings.blend, !framebuffer, mode > 0).draw(pass, {
                vertexArray,
                vertexCount: 4,
                instanceCount: scene.links.length,
                bindings: { positions: positionBuffer, links, params },
              })
            } finally { pass.end() }
          }
          draw(0, color.framebuffer); draw(1, ids.framebuffer); if (display) draw(0)
          device.submit()
          const result = {
            variant,
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
