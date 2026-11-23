import { Buffer, type Device, type TextureFormatColor } from '@luma.gl/core'
import { RenderKernel } from '@luma.gl/graph'
import { ALPHA_BLEND, bindingLayout, createDevice, describeDevice, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { pixels, target, floatPixels } from '../../gpu/rgba-readback'
import { SOURCE_ALPHA_WGSL } from '../../gpu/source-alpha'
import { patternCode, hasPatterns, patternShader } from './patterns'
import { endpointColorShader, resolvedEndpointColor } from './endpoint-colors'
import source from './links.wgsl?raw'
import { HEIGHT, WIDTH, resolveLink, type CoverageFormula } from './data'
import type { Backend, Snapshot } from './backend'
function coverageSource (formula: CoverageFormula): string {
  return formula === 'ascending'
    ? source.replaceAll('smoothstep(0.5,0.5 - input.smoothing,abs(input.coord.y))', '(1.0 - smoothstep(0.5 - input.smoothing,0.5,abs(input.coord.y)))')
    : source
}
function captureSource (program: string): string {
  const signature = '@vertex fn vertexMain(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32)'
  if (!program.includes(signature)) throw new Error('WebGPU vertex capture location changed')
  return `${program.replace(signature, 'fn originalVertex(index: u32, instance: u32)')}
struct CaptureVertex { @builtin(position) position: vec4f, @location(0) @interpolate(flat) clip: vec4f }
@vertex fn captureVertex(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32) -> CaptureVertex {
  let original = originalVertex(index,instance);
  var result: CaptureVertex;
  result.clip = vec4f(original.position.xy,f32(links[instance].endpoints.z + 1u),f32(index + 1u));
  result.position = vec4f((f32(index) + 0.5) * 0.5 - 1.0,1.0 - (f32(instance) + 0.5) * 2.0 / f32(arrayLength(&links)),0,1);
  if (original.position.w != 1.0 || original.position.z != 0.0) { result.position = vec4f(2,2,2,1); }
  return result;
}
@fragment fn captureFragment(input: CaptureVertex) -> @location(0) vec4f { return input.clip; }`
}
export async function createLinksWebGPU (
  canvas: HTMLCanvasElement
): Promise<Backend & { adapter: Device['info'] }> {
  let failure: string | undefined
  const device = await createDevice('webgpu', canvas, false, error => { failure ??= error.message; return true }); const scope = resourceScope()
  try {
    const shaderLayout = {
      attributes: [],
      bindings: bindingLayout([['positions', 'read-only-storage'], ['links', 'read-only-storage'], ['params', 'uniform']]),
    }
    const vertexArray = scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] }))
    const gradientLayout = {
      ...shaderLayout,
      bindings: [...shaderLayout.bindings,
        ...bindingLayout([['pointColors', 'read-only-storage']]).map(b => ({ ...b, location: 3 }))],
    }
    const gradientArray = scope.own(device.createVertexArray({ shaderLayout: gradientLayout, bufferLayout: [] }))
    const kernels = new Map<string, RenderKernel>()
    const kernel = (format: TextureFormatColor, blend: boolean, display: boolean, picking: boolean,
      probe: number, gradient = false, patterned = false, formula: CoverageFormula = 'descending'): RenderKernel => {
      const key = `${format}:${blend}:${display}:${picking}:${probe}:${gradient}:${patterned}:${formula}`
      const cached = kernels.get(key); if (cached) return cached
      const base = probe === 2 ? captureSource(coverageSource(formula)) : coverageSource(formula)
      const decorated = patterned ? patternShader(base, false) : base
      const code = gradient ? endpointColorShader(decorated, 3) : decorated
      const result = scope.own(new RenderKernel(device, {
        vertexSource: `${code}\n${SOURCE_ALPHA_WGSL}`,
        fragmentSource: `${code}\n${SOURCE_ALPHA_WGSL}`,
        vertexEntryPoint: probe === 2 ? 'captureVertex' : 'vertexMain',
        fragmentEntryPoint: probe === 2 ? 'captureFragment' : probe === 1 ? 'varyingProbe' : 'fragmentMain',
        topology: probe === 2 ? 'point-list' : 'triangle-strip',
        shaderLayout: gradient ? gradientLayout : shaderLayout,
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
      info: describeDevice(device),
      adapter: device.info,
      async render (scene, settings, variant, display = true, diagnose = false): Promise<Snapshot> {
        const frame = resourceScope()
        try {
          const width = WIDTH * settings.ratio; const height = HEIGHT * settings.ratio
          if (display) { canvas.width = width; canvas.height = height; device.canvasContext!.resize({ width, height }) }
          const color = frame.own(target(device, width, height)); const ids = frame.own(target(device, width, height))
          const positions = new Float32Array(Math.max(4, scene.points.length * 4))
          scene.points.forEach((p, i) => positions.set([p.x - WIDTH / 2, HEIGHT / 2 - p.y, Number(!!p.absent), 0], i * 4))
          const positionBuffer = frame.own(upload(device, positions))
          const colorBuffer = settings.endpointColors
            ? frame.own(upload(device, new Float32Array(scene.points.length
              ? scene.points.flatMap(p => resolvedEndpointColor(p, settings))
              : [1, 1, 1, 1])))
            : undefined
          const order = scene.links.map((_, i) => i); if (settings.reverse) order.reverse()
          const storage = new ArrayBuffer(Math.max(48, scene.links.length * 48))
          const indices = new Uint32Array(storage); const values = new Float32Array(storage)
          order.forEach((id, row) => {
            const link = resolveLink(scene.links[id], settings); indices.set([link.source, link.target, id, 0], row * 12)
            values.set([...link.color, link.width, patternCode(link, settings), settings.dashLength ?? 5, settings.dashGap ?? 5], row * 12 + 4)
          })
          const links = frame.own(upload(device, new Uint8Array(storage)))
          const patterned = hasPatterns(scene.links, settings)
          const draw = (mode: number, framebuffer?: ReturnType<typeof target>['framebuffer'], probe = 0): void => {
            const gradient = !!settings.endpointColors && mode === 0 && probe === 0
            const params = frame.own(upload(device, new Float32Array([WIDTH, HEIGHT, settings.zoom, settings.ratio,
              settings.widthScale, settings.maxWidth, settings.opacity, settings.indexOffset,
              Number(settings.scaleOnZoom), Number(settings.blend), mode, Number(variant === 'visible')]), Buffer.UNIFORM))
            const format = framebuffer
              ? probe > 0 ? 'rgba32float' : 'rgba8unorm'
              : device.canvasContext!.getCurrentFramebuffer().colorAttachments[0].texture.format as TextureFormatColor
            const pass = device.beginRenderPass({ framebuffer, clearColor: framebuffer ? [0, 0, 0, 0] : [0.14, 0.16, 0.185, 1], clearDepth: false })
            try {
              kernel(format, mode === 0 && settings.blend && probe === 0, !framebuffer, mode > 0,
                probe, gradient, patterned && probe === 0, settings.coverageFormula ?? 'descending').draw(pass, {
                vertexArray: gradient ? gradientArray : vertexArray,
                vertexCount: 4,
                instanceCount: scene.links.length,
                bindings: { positions: positionBuffer, links, params, ...(gradient ? { pointColors: colorBuffer! } : {}) },
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
            const vertices = frame.own(target(device, 4, Math.max(1, scene.links.length), 'rgba32float'))
            draw(0, varying.framebuffer, 1); draw(0, vertices.framebuffer, 2); device.submit()
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
