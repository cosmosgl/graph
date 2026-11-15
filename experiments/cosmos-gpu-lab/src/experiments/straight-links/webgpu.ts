import { Buffer, type TextureFormatColor } from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/engine'
import { ALPHA_BLEND, bindingLayout, createDevice, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { pixels, target, floatPixels } from '../../gpu/rgba-readback'
import { SOURCE_ALPHA_WGSL } from '../../gpu/source-alpha'
import source from './links.wgsl?raw'
import { HEIGHT, WIDTH, resolveLink, type HardCoverage } from './data'
import type { Backend, Snapshot } from './backend'
function coverageSource (method: HardCoverage): string {
  if (method === 'linear') return source.replace('@location(0) coord: vec2f', '@location(0) @interpolate(linear, center) coord: vec2f')
  if (method === 'pixel') {
    return source.replace(
      'let coverage = smoothstep(0.5,0.5 - input.smoothing,abs(input.coord.y));',
      `let distancePx = abs(dot(input.position.xy - input.ribbon.xy,input.ribbon.zw));
     let coverage = smoothstep(input.halfWidth + 0.5,input.halfWidth - 0.5,distancePx);`)
  }
  return source
}
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
    const kernel = (format: TextureFormatColor, blend: boolean, display: boolean, picking: boolean, probe: number, method: HardCoverage): RenderKernel => {
      const key = `${format}:${blend}:${display}:${picking}:${probe}:${method}`; const cached = kernels.get(key); if (cached) return cached
      const result = scope.own(new RenderKernel(device, {
        vertexSource: `${coverageSource(method)}\n${SOURCE_ALPHA_WGSL}`,
        fragmentSource: `${coverageSource(method)}\n${SOURCE_ALPHA_WGSL}`,
        vertexEntryPoint: 'vertexMain',
        fragmentEntryPoint: probe === 1 ? 'varyingProbe' : probe === 2 ? 'pixelProbe' : 'fragmentMain',
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
      async render (scene, settings, variant, display = true, diagnose = false): Promise<Snapshot> {
        const frame = resourceScope()
        try {
          const width = WIDTH * settings.ratio; const height = HEIGHT * settings.ratio
          // Experiments never alter the retained production port, even when
          // a caller carries a different method in its settings.
          const method = variant === 'visible' && !settings.blend ? settings.hardCoverage ?? 'native' : 'native'
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
          const draw = (mode: number, framebuffer?: ReturnType<typeof target>['framebuffer'], probe = 0): void => {
            const params = frame.own(upload(device, new Float32Array([WIDTH, HEIGHT, settings.zoom, settings.ratio,
              settings.widthScale, settings.maxWidth, settings.opacity, settings.indexOffset,
              Number(settings.scaleOnZoom), Number(settings.blend), mode, Number(variant === 'visible')]), Buffer.UNIFORM))
            const format = framebuffer
              ? probe > 0 ? 'rgba32float' : 'rgba8unorm'
              : device.canvasContext!.getCurrentFramebuffer().colorAttachments[0].texture.format as TextureFormatColor
            const pass = device.beginRenderPass({ framebuffer, clearColor: framebuffer ? [0, 0, 0, 0] : [0.14, 0.16, 0.185, 1], clearDepth: false })
            try {
              kernel(format, mode === 0 && settings.blend && probe === 0, !framebuffer, mode > 0, probe, method).draw(pass, {
                vertexArray,
                vertexCount: 4,
                instanceCount: scene.links.length,
                bindings: { positions: positionBuffer, links, params },
              })
            } finally { pass.end() }
          }
          draw(0, color.framebuffer); draw(1, ids.framebuffer); if (display) draw(0)
          device.submit()
          const result: Snapshot = {
            variant,
            hardCoverage: method,
            width,
            height,
            color: await pixels(device, color.texture, color.framebuffer),
            ids: await pixels(device, ids.texture, ids.framebuffer),
          }
          if (diagnose) {
            const varying = frame.own(target(device, width, height, 'rgba32float'))
            const pixel = frame.own(target(device, width, height, 'rgba32float'))
            draw(0, varying.framebuffer, 1); draw(0, pixel.framebuffer, 2); device.submit()
            result.probe = {
              varying: await floatPixels(device, varying.texture, varying.framebuffer),
              pixel: await floatPixels(device, pixel.texture, pixel.framebuffer),
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
