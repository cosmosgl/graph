import { Texture, type Device, type Framebuffer } from '@luma.gl/core'
import { Model } from '@luma.gl/engine'
import { RenderKernel } from '@luma.gl/graph'
import { pixels, target } from '../../gpu/rgba-readback'
import { waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { createStoredAlphaTimer, type StoredAlphaPassTimer, type StoredAlphaTiming } from './stored-alpha-timing'
import { dimensions, type RenderVariant } from './backend'
import type { Point, Settings } from './data'
import { pointOrder } from './point-effects'

export type PixelRegion = { x: number; y: number; width: number; height: number }
export type StoredAlphaOptions = { region: PixelRegion; audit?: boolean; measure?: 'wall' | 'gpu' }
export type StoredAlphaLayer = { id: number; paint: Uint8Array; geometry: Uint8Array }
export type StoredAlphaResult = {
  timing?: StoredAlphaTiming;
  policy: 'stored-alpha-v1'; region: PixelRegion; layers: StoredAlphaLayer[]; cpuIds?: Uint8Array; passes: number;
}
export function validateStoredAlpha (points: Point[], settings: Settings, variant: RenderVariant, options: StoredAlphaOptions): void {
  if (options.audit && options.measure) throw new Error('Timing requires per-point audit readbacks to be disabled')
  const r = options.region; const [width, height] = dimensions(settings)
  if (variant !== 'explicit') throw new Error('Stored-alpha picking uses the unchanged explicit-coordinate color control')
  if (!Object.values(r).every(Number.isInteger) || r.x < 0 || r.y < 0 || r.width < 1 || r.height < 1 ||
      r.width > 64 || r.height > 64 || r.x + r.width > width || r.y + r.height > height || points.length > 1024) {
    throw new Error('Stored-alpha prototype requires an in-bounds region up to 64 × 64 and at most 1024 points')
  }
  if (points.some(p => p.outlined) || settings.hovered?.length || settings.focused !== undefined) {
    throw new Error('Stored-alpha prototype covers point bodies and images; decorative rings are not validated')
  }
}
export function regionScissor (device: Device, height: number, r: PixelRegion): [number, number, number, number] {
  return [r.x, device.type === 'webgl' ? height - r.y - r.height : r.y, r.width, r.height]
}
export function cropRegion (bytes: Uint8Array, width: number, r: PixelRegion): Uint8Array {
  const result = new Uint8Array(r.width * r.height * 4)
  for (let y = 0; y < r.height; y++) {
    const begin = ((r.y + y) * width + r.x) * 4
    result.set(bytes.subarray(begin, begin + r.width * 4), y * r.width * 4)
  }
  return result
}
// CPU composition over measured, isolated GPU paint and geometry. This is an
// attachment-aware reference, not a portable mathematical alpha quantizer.
export function composeStoredAlpha (layers: StoredAlphaLayer[], region: PixelRegion): Uint8Array {
  const ids = new Uint8Array(region.width * region.height * 4)
  for (const layer of layers) {
    for (let offset = 0; offset < ids.length; offset += 4) {
      if (layer.paint[offset + 3] > 0 && layer.geometry[offset + 3] > 0) ids.set(layer.geometry.subarray(offset, offset + 4), offset)
    }
  }
  return ids
}

export async function resolveStoredAlpha (
  device: Device, width: number, height: number, points: Point[], settings: Settings, options: StoredAlphaOptions,
  draw: (id: number, paint: Framebuffer, geometry: Framebuffer, timer?: StoredAlphaPassTimer) => void, output: ReturnType<typeof target>
): Promise<StoredAlphaResult> {
  const scope = resourceScope()
  if (options.measure) await waitForGpu(device)
  const setupStart = performance.now()
  try {
    const sampledTarget = (): Pick<ReturnType<typeof target>, 'texture' | 'framebuffer'> => {
      const texture = scope.own(device.createTexture({
        width,
        height,
        format: 'rgba8unorm',
        usage: Texture.RENDER | Texture.SAMPLE | Texture.COPY_SRC,
        sampler: { minFilter: 'nearest', magFilter: 'nearest' },
      }))
      const framebuffer = scope.own(device.createFramebuffer({ width, height, colorAttachments: [texture] }))
      return { texture, framebuffer }
    }
    const paint = sampledTarget(); const geometry = sampledTarget()
    const bindings = { paint: paint.texture, geometry: geometry.texture }
    const gl = device.type === 'webgl'
      ? scope.own(new Model(device, {
        vs: `#version 300 es
void main() {
  const vec2 corners[3] = vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));
  gl_Position = vec4(corners[gl_VertexID],0,1);
}`,
        fs: `#version 300 es
precision highp float;
uniform sampler2D paint; uniform sampler2D geometry; out vec4 color;
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 id = texelFetch(geometry,pixel,0);
  if (texelFetch(paint,pixel,0).a == 0.0 || id.a == 0.0) discard;
  color = id;
}`,
        topology: 'triangle-list',
        vertexCount: 3,
        bindings,
        parameters: { blend: false, depthWriteEnabled: false, depthCompare: 'always', cullMode: 'none' },
      }))
      : undefined
    const shaderLayout = {
      attributes: [],
      bindings: ['paint', 'geometry'].map((name, location) => ({
        name, location, group: 0, type: 'texture' as const, sampleType: 'float' as const, viewDimension: '2d' as const,
      })),
    }
    const shader = `@group(0) @binding(0) var paint: texture_2d<f32>;
@group(0) @binding(1) var geometry: texture_2d<f32>;
@vertex fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let corners = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(corners[i],0,1);
}
@fragment fn fragmentMain(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let pixel = vec2i(p.xy); let id = textureLoad(geometry,pixel,0);
  if (textureLoad(paint,pixel,0).a == 0.0 || id.a == 0.0) { discard; } return id;
}`
    const gpu = device.type === 'webgpu'
      ? scope.own(new RenderKernel(device, {
        vertexSource: shader,
        fragmentSource: shader,
        vertexEntryPoint: 'vertexMain',
        fragmentEntryPoint: 'fragmentMain',
        shaderLayout,
        topology: 'triangle-list',
        colorAttachmentFormats: ['rgba8unorm'],
        parameters: { blend: false, cullMode: 'none' },
      }))
      : undefined
    const vertexArray = gpu ? scope.own(device.createVertexArray({ shaderLayout, bufferLayout: [] })) : undefined
    const setupCpuMs = performance.now() - setupStart
    const queryStart = performance.now()
    const timer = options.measure ? scope.own(createStoredAlphaTimer(device, 1 + points.length * 3, options.measure === 'gpu')) : undefined
    const querySetupCpuMs = performance.now() - queryStart
    if (options.measure) await waitForGpu(device)
    const begin = (props: NonNullable<Parameters<Device['beginRenderPass']>[0]>, stage: import('./stored-alpha-timing').StoredAlphaStage):
    ReturnType<Device['beginRenderPass']> => timer ? timer.begin(props, stage) : device.beginRenderPass(props)
    const end = (pass: ReturnType<Device['beginRenderPass']>): void => { if (timer) timer.end(pass); else pass.end() }
    const encodeStart = performance.now()
    // Clear the whole ID target once. Each eligible point overwrites its own
    // covered pixels; rejected fragments leave the previously visible ID intact.
    const clear = begin({ framebuffer: output.framebuffer, clearColor: [0, 0, 0, 0], clearDepth: false }, 'clear')
    end(clear)
    const layers: StoredAlphaLayer[] = []
    for (const id of pointOrder(points, settings)) {
      draw(id, paint.framebuffer, geometry.framebuffer, timer)
      const pass = begin({ framebuffer: output.framebuffer, clearColor: false, clearDepth: false }, 'resolve')
      try {
        pass.setParameters({ scissorRect: regionScissor(device, height, options.region) })
        if (gl) gl.draw(pass)
        else gpu!.draw(pass, { vertexArray: vertexArray!, vertexCount: 3, bindings })
      } finally { end(pass) }
      if (options.audit) {
        device.submit()
        layers.push({
          id,
          paint: cropRegion(await pixels(device, paint.texture, paint.framebuffer), width, options.region),
          geometry: cropRegion(await pixels(device, geometry.texture, geometry.framebuffer), width, options.region),
        })
      }
    }
    device.submit()
    const encodeSubmitCpuMs = performance.now() - encodeStart
    let timing: StoredAlphaTiming | undefined
    if (options.measure) {
      await waitForGpu(device)
      const completionWallMs = performance.now() - encodeStart
      const queryReadStart = performance.now(); const gpu = await timer!.read()
      // A sum larger than its enclosing, synchronized wall interval is not a
      // trustworthy serial cost. Keep the reason instead of publishing it.
      if (gpu.gpuMs !== null && gpu.gpuMs > completionWallMs) {
        gpu.timerDetail = `GPU pass sum ${gpu.gpuMs} ms exceeds completion wall ${completionWallMs} ms`
        gpu.gpuMs = null; gpu.stageGpuMs = null; gpu.timerStatus = 'invalid'
      }
      timing = {
        mode: options.measure,
        setupCpuMs,
        querySetupCpuMs,
        encodeSubmitCpuMs,
        completionWallMs,
        queryReadbackWallMs: performance.now() - queryReadStart,
        scratchBytes: width * height * 4 * 2,
        ...gpu,
      }
    }
    return {
      timing,
      policy: 'stored-alpha-v1',
      region: { ...options.region },
      layers,
      cpuIds: options.audit ? composeStoredAlpha(layers, options.region) : undefined,
      passes: 1 + points.length * 3,
    }
  } finally { scope.destroy() }
}
