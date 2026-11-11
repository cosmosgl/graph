import { Buffer, type Device, type RenderPass, type ComputePass } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, createDevice, createStorageRenderer, readFloats, upload, waitForGpu } from '../../gpu/luma'
import { resourceScope, type BufferLedger } from '../../gpu/resource-scope'
import type { Backend, View, PositionSource, ComputeScope } from './backend'
import type { Snapshot } from './reference'
import { measureBatch, timestamps, type TimestampWrites } from './timing'
import { nearLimit, validateInput, type Input, type Parameters, type Variant } from './data'
import forceSource from './force.wgsl?raw'
import integrationSource from './integrate.wgsl?raw'

const renderSource = `
@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> view: vec4<f32>;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) color: vec3<f32> }
@vertex fn vertexMain(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Vertex {
  let corners = array<vec2<f32>,6>(vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
  let p = positions[i]; var result: Vertex;
  result.position = vec4(3.,3.,0.,1.);
  if (p.w <= 0.5) { result.position = vec4((p.xy - view.xy) * view.zw + corners[v] * vec2(5. / 480., 5. / 340.), 0., 1.); }
  result.uv = corners[v]; result.color = select(vec3(0.62,0.71,0.84),vec3(1.,0.72,0.4), p.z > 0.5);
  return result;
}
@fragment fn fragmentMain(input: Vertex) -> @location(0) vec4<f32> {
  if (dot(input.uv,input.uv) > 1.) { discard; }
  return vec4(input.color,1.);
}`

export type WebGPUForceFactory = (resources: {
  device: Device; positions: Buffer[]; samples: Buffer; forces: Buffer; count: number; capacity: number;
}) => Promise<{
  prepare?(): void; encode(source: number, timing: TimestampWrites, pass?: ComputePass, profile?: ComputeScope): void;
  resize?(input: Input): void;
  render?(source: number, view: View, pass: RenderPass): void;
  integrate?(source: number, timing: TimestampWrites, pass?: ComputePass): boolean; destroy(): void;
}>
export type BackendContext = { device: Device; ledger?: BufferLedger; check?(): void }
export type WebGPUOptions = { context?: BackendContext; preserve?: PositionSource }
const deviceLosses = new WeakMap<Device, { message?: string }>()
const absentSource = `
@group(0) @binding(0) var<storage, read_write> source: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> outputPoints: array<vec4f>;
@group(0) @binding(2) var<uniform> patchParams: vec4u;
@compute @workgroup_size(1) fn main() {
  var point = source[patchParams.x]; point.w = f32(patchParams.y);
  source[patchParams.x] = point; outputPoints[patchParams.x] = point;
}`
export async function createWebGPU (
  canvas: HTMLCanvasElement, input: Input, p: Parameters, variant: Variant, customForce?: WebGPUForceFactory,
  options: WebGPUOptions = {}
): Promise<Backend> {
  validateInput(input, p, customForce ? 16384 : 4096)
  let failure: string | undefined; let destroyed = false
  const device = options.context?.device ?? await createDevice('webgpu', canvas, true, error => { failure = error.message })
  let loss = deviceLosses.get(device)
  if (!loss) {
    loss = {}; deviceLosses.set(device, loss); const state = loss
    device.lost.then(info => { state.message = `WebGPU device lost: ${info.reason} · ${info.message}` })
  }
  const scope = resourceScope(options.context?.ledger); const own = scope.own
  const healthy = (): void => {
    options.context?.check?.()
    if (destroyed || failure || loss.message || device.isLost) throw new Error(failure ?? loss.message ?? 'WebGPU device lost or destroyed')
  }
  try {
    let count = input.points.length / 4
    const capacity = count
    healthy()
    if (options.preserve && options.preserve.device !== device) throw new Error('Cannot copy positions between devices')
    const preserved = Math.min(options.preserve?.count ?? 0, count)
    const tail = input.points.subarray(preserved * 4)
    const positions = [0, 1].map(() => {
      const buffer = own(device.createBuffer({
        byteLength: Math.max(16, capacity * 16),
        usage: Buffer.STORAGE | Buffer.COPY_SRC | Buffer.COPY_DST,
      }))
      if (tail.byteLength) buffer.write(tail, preserved * 16)
      return buffer
    })
    let copySubmitMs = 0
    if (preserved) {
      const start = performance.now()
      for (const destinationBuffer of positions) {
        device.commandEncoder.copyBufferToBuffer({
          sourceBuffer: options.preserve!.buffer, destinationBuffer, size: preserved * 16,
        })
      }
      device.submit(); copySubmitMs = performance.now() - start
    }
    const samples = own(upload(device, input.samples))
    const forces = own(upload(device, new Float32Array(input.points.length)))
    const params = own(upload(device, new Float32Array([
      count, p.alpha, p.repulsion, nearLimit(count, p), p.friction, p.referenceLength, 0, 0,
    ]), Buffer.UNIFORM))
    const viewBuffer = own(upload(device, new Float32Array([0, 0, 1, 1]), Buffer.UNIFORM))
    const patch = own(upload(device, new Uint32Array(4), Buffer.UNIFORM))
    const absent = own(await Kernel.createAsync(device, {
      source: absentSource,
      shaderLayout: { bindings: bindingLayout([['source', 'storage'], ['outputPoints', 'storage'], ['patchParams', 'uniform']]) },
    }))
    const force = own(await Kernel.createAsync(device, {
      source: forceSource,
      entryPoint: variant,
      shaderLayout: {
        bindings: bindingLayout([
          ['positions', 'read-only-storage'], ['samples', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
        ]),
      },
    }))
    const integrate = own(await Kernel.createAsync(device, {
      source: integrationSource,
      shaderLayout: {
        bindings: bindingLayout([
          ['positions', 'read-only-storage'], ['forces', 'read-only-storage'], ['params', 'uniform'], ['output', 'storage'],
        ]),
      },
    }))
    const renderer = own(createStorageRenderer(device, renderSource, 'triangle-list', bindingLayout([['positions', 'read-only-storage'], ['view', 'uniform']])))
    let current = 0
    const extension = customForce ? own(await customForce({ device, positions, samples, forces, count, capacity })) : undefined
    const encodeForce = (forceTimes: TimestampWrites = {}, sharedPass?: ComputePass, profile?: ComputeScope): void => {
      if (extension) { extension.encode(current, forceTimes, sharedPass, profile); return }
      if (profile) { profile('force', pass => encodeForce({}, pass)); return }
      const forcePass = sharedPass ?? device.beginComputePass(forceTimes)
      try {
        force.dispatch(forcePass, { x: Math.ceil(count / 64), bindings: { positions: positions[current], samples, params, forces } })
      } finally { if (!sharedPass) forcePass.end() }
    }
    const encodeIntegration = (integrationTimes: TimestampWrites = {}, sharedPass?: ComputePass): void => {
      if (extension?.integrate?.(current, integrationTimes, sharedPass)) return
      const integratePass = sharedPass ?? device.beginComputePass(integrationTimes)
      try {
        integrate.dispatch(integratePass, {
          x: Math.ceil(count / 64),
          bindings: { positions: positions[current], forces, params, output: positions[1 - current] },
        })
      } finally { if (!sharedPass) integratePass.end() }
    }
    await waitForGpu(device); healthy()
    return {
      name: `WebGPU ${variant}`,
      info: `${device.info.vendor} ${device.info.renderer}; luma Kernel / RenderKernel; 64 invocations per group`,
      positionSource (): PositionSource { healthy(); return { device, buffer: positions[current], count } },
      positionTransfer: { preserved, copiedBytes: preserved * 32, uploadedBytes: tail.byteLength * 2, copySubmitMs },
      resizeInput (next, preserve): ReturnType<NonNullable<Backend['resizeInput']>> {
        healthy(); validateInput(next, p, capacity)
        if (customForce && !extension?.resize) throw new Error('Force does not support logical-count changes')
        const kept = preserve ? Math.min(count, next.points.length / 4) : 0
        // Validate/reconfigure dependent resources before changing base state.
        extension?.resize?.(next)
        const tail = next.points.subarray(kept * 4)
        if (tail.byteLength) positions.forEach(buffer => buffer.write(tail, kept * 16))
        if (next.samples.byteLength) samples.write(next.samples)
        input = next; count = next.points.length / 4
        params.write(new Float32Array([count, p.alpha, p.repulsion, nearLimit(count, p), p.friction, p.referenceLength, 0, 0]))
        return { preserved: kept, copiedBytes: 0, uploadedBytes: tail.byteLength * 2, copySubmitMs: 0 }
      },
      setAbsent (index, value): void {
        healthy()
        if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('Invalid absent-point index')
        patch.write(new Uint32Array([index, value ? 1 : 0, 0, 0]))
        const pass = device.beginComputePass()
        try {
          absent.dispatch(pass, { x: 1, bindings: { source: positions[current], outputPoints: positions[1 - current], patchParams: patch } })
        } finally { pass.end() }
        device.submit()
      },
      setPositions (data): void {
        healthy()
        if (data.length !== input.points.length) throw new Error('Point count changed; recreate the backend')
        positions.forEach(buffer => { if (data.byteLength) buffer.write(data) }); current = 0
      },
      resourceIdentity (): { device: string; positions: string[] } {
        healthy(); return { device: device.id, positions: positions.map(buffer => buffer.id) }
      },
      patchPositions (first, data): void {
        healthy()
        if (!Number.isInteger(first) || first < 0 || data.length % 4 || first + data.length / 4 > count) throw new Error('Invalid position patch range')
        for (let i = 0; i < data.length; i += 4) {
          if (![data[i + 2], data[i + 3]].every(Number.isFinite) ||
            (data[i + 3] <= 0.5 && ![data[i], data[i + 1]].every(Number.isFinite))) throw new Error('Invalid position patch values')
        }
        if (data.byteLength) positions.forEach(buffer => buffer.write(data, first * 16))
      },
      step (timing = {}): void {
        healthy()
        if (timing.pass && timing.submit !== false) throw new Error('A borrowed pass requires caller-owned submission')
        if (timing.profile && (timing.pass || timing.submit !== false)) throw new Error('Profiling owns its passes and submission')
        if (!count) return
        extension?.prepare?.()
        encodeForce(timing.force, timing.pass, timing.profile)
        if (timing.profile) timing.profile('integration', pass => encodeIntegration({}, pass))
        else encodeIntegration(timing.integration, timing.pass)
        current = 1 - current
        if (timing.submit !== false) device.submit()
      },
      async measure (stage, operations): ReturnType<Backend['measure']> {
        healthy()
        extension?.prepare?.()
        if (!count) throw new Error('Cannot benchmark empty input')
        const timing = await measureBatch(device, operations, (query, first, last) => {
          encodeForce(timestamps(query, first, last && stage === 'force'))
          if (stage === 'step') encodeIntegration(timestamps(query, false, last))
        }).catch(error => { healthy(); throw error })
        healthy()
        const snapshot = {
          forces: await readFloats(forces, input.points.byteLength),
          positions: await readFloats(positions[stage === 'step' ? 1 - current : current], input.points.byteLength),
        }
        healthy(); return { timing, snapshot }
      },
      async read (): Promise<Snapshot> {
        healthy()
        if (!count) return { forces: new Float32Array(), positions: new Float32Array() }
        await waitForGpu(device)
        const result = { forces: await readFloats(forces, input.points.byteLength), positions: await readFloats(positions[current], input.points.byteLength) }
        healthy(); return result
      },
      render (view, timing = {}, submit = true): void {
        healthy(); viewBuffer.write(new Float32Array(view))
        const pass = device.beginRenderPass({ clearColor: [0.075, 0.087, 0.105, 1], clearDepth: false, ...timing })
        try {
          if (count) {
            extension?.render?.(current, view, pass)
            renderer.kernel.draw(pass, {
              vertexArray: renderer.vertexArray,
              vertexCount: 6,
              instanceCount: count,
              bindings: { positions: positions[current], view: viewBuffer },
            })
          }
        } finally { pass.end() }
        if (submit) device.submit()
      },
      destroy (): void {
        if (destroyed) return
        destroyed = true
        try { scope.destroy() } finally { if (!options.context) device.destroy() }
      },
    }
  } catch (error) {
    try { scope.destroy() } finally { if (!options.context) device.destroy() }
    throw error
  }
}
