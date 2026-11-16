import { Buffer, type TextureFormatColor } from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/graph'
import { ALPHA_BLEND, bindingLayout, createDevice, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { pixels, target, floatPixels } from '../../gpu/rgba-readback'
import { SOURCE_ALPHA_WGSL } from '../../gpu/source-alpha'
import source from './curves.wgsl?raw'
import { HEIGHT, WIDTH, resolveLink } from './data'
import type { Backend, Snapshot } from './backend'
import { productionGeometry } from './geometry'
function captureSource (): string {
  const signature = '@vertex fn vertexMain(@builtin(vertex_index) index: u32,@builtin(instance_index) instance: u32)'
  if (!source.includes(signature)) throw new Error('Curved vertex capture location changed')
  return `${source.replace(signature, 'fn originalVertex(index: u32, instance: u32)')}
struct CaptureVertex { @builtin(position) position: vec4f, @location(0) @interpolate(flat) clip: vec4f }
@vertex fn captureVertex(@builtin(vertex_index) index: u32,@builtin(instance_index) instance: u32) -> CaptureVertex {
  let original = originalVertex(index,instance); var result: CaptureVertex;
  result.clip = vec4f(original.position.xy,f32(links[instance].endpoints.z + 1u),f32(index + 1u));
  result.position = vec4f((f32(index) + 0.5) * 2.0 / f32(arrayLength(&nodes)) - 1.0,
    1.0 - (f32(instance) + 0.5) * 2.0 / f32(arrayLength(&links)),0,1);
  if (original.position.w != 1.0 || original.position.z != 0.0) { result.position = vec4f(2,2,2,1); }
  return result;
}
@fragment fn captureFragment(input: CaptureVertex) -> @location(0) vec4f { return input.clip; }`
}
const varyingSource = `${source}
@fragment fn varyingProbe(input: Vertex) -> @location(0) vec4f {
  let coverage = smoothstep(0.5,0.5 - input.smoothing,abs(input.coord.y));
  return vec4f(input.coord.y,input.smoothing,coverage,f32(input.id + 1u));
}`
export async function createCurvesWebGPU (canvas: HTMLCanvasElement): Promise<Backend> {
  let failure: string | undefined
  const device = await createDevice('webgpu', canvas, false, error => { failure ??= error.message; return true }); const scope = resourceScope()
  try {
    const shaderLayout = {
      attributes: [],
      bindings: bindingLayout([['positions', 'read-only-storage'], ['links', 'read-only-storage'], ['params', 'uniform'], ['nodes', 'read-only-storage']]),
    }
    const vertexArray = scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] }))
    const kernels = new Map<string, RenderKernel>()
    const kernel = (format: TextureFormatColor, blend: boolean, display: boolean, picking: boolean, front: boolean, probe = 0): RenderKernel => {
      const key = `${format}:${blend}:${display}:${picking}:${front}:${probe}`; const cached = kernels.get(key); if (cached) return cached
      const result = scope.own(new RenderKernel(device, {
        vertexSource: `${probe === 3 ? captureSource() : probe === 1 ? varyingSource : source}\n${SOURCE_ALPHA_WGSL}`,
        fragmentSource: `${probe === 3 ? captureSource() : probe === 1 ? varyingSource : source}\n${SOURCE_ALPHA_WGSL}`,
        vertexEntryPoint: probe === 3 ? 'captureVertex' : 'vertexMain',
        fragmentEntryPoint: probe === 3 ? 'captureFragment' : probe === 1 ? 'varyingProbe' : 'fragmentMain',
        topology: probe === 3 ? 'point-list' : 'triangle-strip',
        shaderLayout,
        colorAttachmentFormats: [format],
        depthStencilAttachmentFormat: display
          ? device.canvasContext!.getCurrentFramebuffer().depthStencilAttachment?.texture.format as 'depth24plus'
          : undefined,
        parameters: {
          ...(blend ? ALPHA_BLEND : { blend: false }),
          cullMode: picking && !front ? 'none' : 'back',
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
          const geometry = productionGeometry(settings)
          const nodes = frame.own(upload(device, geometry))
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
              Number(settings.scaleOnZoom), Number(settings.blend), mode, Number(variant !== 'production'),
              settings.segments, settings.weight, settings.controlDistance, 0]), Buffer.UNIFORM))
            const format = framebuffer
              ? probe > 0 ? 'rgba32float' : 'rgba8unorm'
              : device.canvasContext!.getCurrentFramebuffer().colorAttachments[0].texture.format as TextureFormatColor
            const pass = device.beginRenderPass({ framebuffer, clearColor: framebuffer ? [0, 0, 0, 0] : [0.14, 0.16, 0.185, 1], clearDepth: false })
            try {
              kernel(format, mode === 0 && settings.blend && probe === 0, !framebuffer, mode > 0, variant === 'front', probe).draw(pass, {
                vertexArray,
                vertexCount: geometry.length / 2,
                instanceCount: scene.links.length,
                bindings: { positions: positionBuffer, links, params, nodes },
              })
            } finally { pass.end() }
          }
          draw(0, color.framebuffer); draw(1, ids.framebuffer); if (display) draw(0)
          device.submit()
          const result: Snapshot = {
            variant,
            width,
            height,
            color: await pixels(device, color.texture, color.framebuffer),
            ids: await pixels(device, ids.texture, ids.framebuffer),
          }
          if (diagnose) {
            const varying = frame.own(target(device, width, height, 'rgba32float'))
            const vertices = frame.own(target(device, geometry.length / 2, Math.max(1, scene.links.length), 'rgba32float'))
            draw(0, varying.framebuffer, 1); draw(0, vertices.framebuffer, 3); device.submit()
            result.probe = {
              varying: await floatPixels(device, varying.texture, varying.framebuffer),
              vertices: await floatPixels(device, vertices.texture, vertices.framebuffer),
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
