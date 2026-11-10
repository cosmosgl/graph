import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, createDevice, createStorageRenderer, readFloats, upload, waitForGpu } from '../../gpu/luma'
import type { Backend } from './backend'
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

export async function createWebGPU (canvas: HTMLCanvasElement, input: Input, p: Parameters, variant: Variant): Promise<Backend> {
  validateInput(input, p)
  let failure: string | undefined
  const device = await createDevice('webgpu', canvas, true, error => { failure = error.message })
  const owned: Array<{ destroy(): void }> = []
  const own = <T extends { destroy(): void }>(resource: T): T => { owned.push(resource); return resource }
  const healthy = (): void => { if (failure || device.isLost) throw new Error(failure ?? 'WebGPU device lost') }
  try {
    const count = input.points.length / 4
    const positions = [own(upload(device, input.points)), own(upload(device, input.points))]
    const samples = own(upload(device, input.samples))
    const forces = own(upload(device, new Float32Array(input.points.length)))
    const params = own(upload(device, new Float32Array([
      count, p.alpha, p.repulsion, nearLimit(count, p), p.friction, p.referenceLength, 0, 0,
    ]), Buffer.UNIFORM))
    const viewBuffer = own(upload(device, new Float32Array([0, 0, 1, 1]), Buffer.UNIFORM))
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
    let current = 0; let destroyed = false
    const encodeForce = (forceTimes: TimestampWrites = {}): void => {
      const forcePass = device.beginComputePass(forceTimes)
      try {
        force.dispatch(forcePass, { x: Math.ceil(count / 64), bindings: { positions: positions[current], samples, params, forces } })
      } finally { forcePass.end() }
    }
    const encodeIntegration = (integrationTimes: TimestampWrites = {}): void => {
      const integratePass = device.beginComputePass(integrationTimes)
      try {
        integrate.dispatch(integratePass, {
          x: Math.ceil(count / 64),
          bindings: { positions: positions[current], forces, params, output: positions[1 - current] },
        })
      } finally { integratePass.end() }
    }
    await waitForGpu(device); healthy()
    return {
      name: `WebGPU ${variant}`,
      info: `${device.info.vendor} ${device.info.renderer}; luma Kernel / RenderKernel; 64 invocations per group`,
      setPositions (data): void {
        healthy()
        if (data.length !== input.points.length) throw new Error('Point count changed; recreate the backend')
        positions.forEach(buffer => { if (data.byteLength) buffer.write(data) }); current = 0
      },
      step (): void {
        healthy()
        if (!count) return
        encodeForce(); encodeIntegration()
        current = 1 - current; device.submit()
      },
      async measure (stage, operations): ReturnType<Backend['measure']> {
        healthy()
        if (!count) throw new Error('Cannot benchmark empty input')
        const timing = await measureBatch(device, operations, (query, first, last) => {
          encodeForce(timestamps(query, first, last && stage === 'force'))
          if (stage === 'step') encodeIntegration(timestamps(query, false, last))
        })
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
      render (view): void {
        healthy(); viewBuffer.write(new Float32Array(view))
        const pass = device.beginRenderPass({ clearColor: [0.075, 0.087, 0.105, 1], clearDepth: false })
        try {
          if (count) {
            renderer.kernel.draw(pass, {
              vertexArray: renderer.vertexArray,
              vertexCount: 6,
              instanceCount: count,
              bindings: { positions: positions[current], view: viewBuffer },
            })
          }
        } finally { pass.end() }
        device.submit()
      },
      destroy (): void {
        if (destroyed) return
        destroyed = true
        try { owned.reverse().forEach(resource => resource.destroy()) } finally { device.destroy() }
      },
    }
  } catch (error) {
    try { owned.reverse().forEach(resource => resource.destroy()) } finally { device.destroy() }
    throw error
  }
}
