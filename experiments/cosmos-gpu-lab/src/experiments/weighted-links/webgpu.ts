import { Buffer, luma, type BindingDeclaration } from '@luma.gl/core'
import { Kernel, RenderKernel } from '@luma.gl/engine'
import { webgpuAdapter, type WebGPUDevice } from '@luma.gl/webgpu'
import type { LinkBackend, Measurement, Stage, SetupSubmission } from './backend'
import type { GraphInput, Parameters, Topology } from './data'
import type { Snapshot } from './reference'
import { normalizeMeasurement, TIMING_POLICY } from './timing'
import forceSource from './force.wgsl?raw'
import integrateSource from './integrate.wgsl?raw'

function bindings (names: string[], writable?: string, uniform?: string): BindingDeclaration[] {
  return names.map((name, location): BindingDeclaration => {
    const slot = { name, location, group: 0 }
    if (name === uniform) return { ...slot, type: 'uniform' }
    return { ...slot, type: name === writable ? 'storage' : 'read-only-storage' }
  })
}
const renderBindings = bindings(['positions', 'links'])
const vertexSource = `
@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> links: array<u32>;
struct Vertex { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) color: vec3<f32> }
@vertex fn point(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Vertex {
  let corners = array<vec2<f32>,6>(vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(-1.,1.), vec2(1.,-1.), vec2(1.,1.));
  let p = positions[i]; var result: Vertex;
  result.position = vec4(p.xy + corners[v] * vec2(5. / 480., 5. / 340.), 0., 1.);
  if (p.w > 0.5) { result.position = vec4(3.,3.,0.,1.); }
  result.uv = corners[v]; result.color = select(vec3(0.48,0.76,0.84), vec3(1.,0.72,0.4), p.z > 0.5);
  return result;
}
@vertex fn link(@builtin(vertex_index) v: u32) -> Vertex {
  let a = positions[links[(v / 2u) * 2u]]; let b = positions[links[(v / 2u) * 2u + 1u]];
  var result: Vertex; result.position = vec4(positions[links[v]].xy, 0., 1.);
  if (a.w > 0.5 || b.w > 0.5) { result.position = vec4(3.,3.,0.,1.); }
  result.uv = vec2(0.); result.color = vec3(0.27,0.35,0.43); return result;
}
@fragment fn fragment(input: Vertex) -> @location(0) vec4<f32> {
  if (dot(input.uv, input.uv) > 1.) { discard; }
  return vec4(input.color, 1.);
}`

export async function createWebGPUBackend (canvas: HTMLCanvasElement): Promise<LinkBackend> {
  const device = await luma.createDevice({
    type: 'webgpu',
    adapters: [webgpuAdapter],
    waitForPageLoad: false,
    optionalFeatures: ['timestamp-query'],
    featureLevel: 'core',
    createCanvasContext: { canvas, autoResize: false, useDevicePixels: false, alphaMode: 'opaque' },
  }) as WebGPUDevice
  let failure: string | undefined
  device.lost.then(info => { if (info.reason !== 'destroyed') failure = `WebGPU device lost: ${info.message}` })
  device.handle.addEventListener('uncapturederror', event => { failure = `WebGPU validation error: ${event.error.message}` })
  const assertHealthy = (): void => { if (failure) throw new Error(failure) }
  const owned: Array<{ destroy(): void }> = []
  try {
    const force = new Kernel(device, {
      source: forceSource,
      shaderLayout: { bindings: bindings(['positions', 'offsets', 'edges', 'sizes', 'params', 'forces'], 'forces', 'params') },
    })
    owned.push(force)
    const integrate = new Kernel(device, {
      source: integrateSource, shaderLayout: { bindings: bindings(['positions', 'forces', 'params', 'output'], 'output', 'params') },
    })
    owned.push(integrate)
    const makeRender = (point: boolean): RenderKernel => new RenderKernel(device, {
      vertexSource,
      fragmentSource: vertexSource,
      vertexEntryPoint: point ? 'point' : 'link',
      fragmentEntryPoint: 'fragment',
      topology: point ? 'triangle-list' : 'line-list',
      parameters: { depthWriteEnabled: false, depthCompare: 'always' },
      shaderLayout: { attributes: [], bindings: point ? renderBindings.slice(0, 1) : renderBindings },
      colorAttachmentFormats: [device.canvasContext!.colorFormat!],
    })
    const points = makeRender(true); owned.push(points)
    const lines = makeRender(false); owned.push(lines)
    const vertexArray = device.createVertexArray({ shaderLayout: { attributes: [], bindings: [] }, bufferLayout: [] }); owned.push(vertexArray)
    const timer = device.features.has('timestamp-query') ? device.createQuerySet({ type: 'timestamp', count: 2 }) : undefined
    if (timer) owned.push(timer)
    let buffers: Buffer[] = []
    let positions: Buffer[]; let forces: Buffer[]; let offsets: Buffer[]; let edges: Buffer[]
    let sizes: Buffer; let params: Buffer; let links: Buffer
    let graph: GraphInput; let topology: Topology; let uploadCallMs = 0
    const upload = (data: Float32Array | Uint32Array | Uint8Array, usage = Buffer.STORAGE): Buffer => {
      const buffer = device.createBuffer({ byteLength: Math.max(16, data.byteLength), usage: usage | Buffer.COPY_DST | Buffer.COPY_SRC })
      const started = performance.now()
      if (data.byteLength) buffer.write(data)
      uploadCallMs += performance.now() - started
      buffers.push(buffer); return buffer
    }
    const timestamps = (begin: boolean, end: boolean): Record<string, unknown> => timer && (begin || end)
      ? { timestampQuerySet: timer, beginTimestampIndex: begin ? 0 : undefined, endTimestampIndex: end ? 1 : undefined }
      : {}
    const encodeForce = (side: number, begin = false, end = false): void => {
      const pass = device.beginComputePass(timestamps(begin, end))
      force.dispatch(pass, {
        x: Math.ceil(graph.points.length / 4 / 64),
        bindings: {
          positions: positions[side], offsets: offsets[side], edges: edges[side], sizes, params, forces: forces[side],
        },
      })
      pass.end()
    }
    const encodeRender = (positionIndex = 0, begin = false, end = false): void => {
      const pass = device.beginRenderPass({
        clearColor: [0.075, 0.087, 0.105, 1],
        clearDepth: false,
        ...timestamps(begin, end),
      })
      if (topology.links.length) lines.draw(pass, { vertexArray, vertexCount: topology.links.length, bindings: { positions: positions[positionIndex], links } })
      points.draw(pass, { vertexArray, vertexCount: 6, instanceCount: graph.points.length / 4, bindings: { positions: positions[positionIndex] } })
      pass.end()
    }
    const encodeIntegrate = (side: number, frozen = false, begin = false, end = false): void => {
      const pass = device.beginComputePass(timestamps(begin, end))
      integrate.dispatch(pass, {
        x: Math.ceil(graph.points.length / 4 / 64),
        bindings: { positions: positions[side], forces: forces[side], params, output: positions[side === 1 && frozen ? 2 : 1 - side] },
      })
      pass.end()
    }
    const encodeTick = (render: boolean, frozen = false, begin = false, end = false): void => {
      for (let side = 0; side < 2; side++) {
        encodeForce(side, begin && side === 0)
        encodeIntegrate(side, frozen)
      }
      if (render) encodeRender(frozen ? 2 : 0, false, end)
    }
    const encodeStage = (stage: Stage, begin: boolean, end: boolean): void => {
      if (stage === 'force') {
        encodeForce(0, begin); encodeForce(1, false, end)
      } else if (stage === 'integration') {
        encodeIntegrate(0, true, begin); encodeIntegrate(1, true, false, end)
      } else if (stage === 'render') encodeRender(2, begin, end)
      else encodeTick(true, true, begin, end)
    }
    const backend: LinkBackend = {
      name: 'WebGPU',
      info: `${[device.info.vendor, device.info.renderer].filter(Boolean).join(' ')}; ` +
        `luma Kernel + RenderKernel; timestamps ${timer ? 'available' : 'unavailable'}`,
      setGraph (next: GraphInput, nextTopology: Topology, p: Parameters): SetupSubmission {
        assertHealthy()
        const started = performance.now(); uploadCallMs = 0
        buffers.forEach(buffer => buffer.destroy()); buffers = []
        graph = next; topology = nextTopology
        positions = [upload(graph.points), upload(graph.points), upload(graph.points)]
        forces = [upload(new Float32Array(graph.points.length)), upload(new Float32Array(graph.points.length))]
        offsets = topology.directions.map(direction => upload(direction.offsets))
        edges = topology.directions.map(direction => {
          const data = new ArrayBuffer(direction.neighbors.length * 16)
          const ints = new Uint32Array(data); const floats = new Float32Array(data)
          for (let i = 0; i < direction.neighbors.length; i++) {
            ints[i * 4] = direction.neighbors[i]
            floats.set(direction.properties.subarray(i * 4, i * 4 + 3), i * 4 + 1)
          }
          return upload(new Uint8Array(data))
        })
        sizes = upload(graph.sizes); links = upload(topology.links)
        params = upload(new Float32Array([
          p.spring, p.distance, ...p.variation, p.alpha, p.friction, p.maxStep, Number(p.collision),
          p.radius, p.padding, graph.points.length / 4, 0,
        ]), Buffer.UNIFORM)
        return { setupSubmitMs: performance.now() - started, uploadCallMs }
      },
      async synchronize (): Promise<void> { assertHealthy(); await device.handle.queue.onSubmittedWorkDone(); assertHealthy() },
      reset (): void { positions.forEach(buffer => buffer.write(graph.points)) },
      step (render = true): void { assertHealthy(); encodeTick(render); device.submit() },
      render (): void { assertHealthy(); encodeRender(); device.submit() },
      async diagnosePass (pass): Promise<Float32Array> {
        assertHealthy()
        const side = pass === 'firstForce' || pass === 'intermediate' ? 0 : 1
        const isForce = pass === 'firstForce' || pass === 'secondForce'
        if (isForce) encodeForce(side); else encodeIntegrate(side)
        device.submit()
        await backend.synchronize()
        const buffer = isForce ? forces[side] : positions[1 - side]
        const bytes = await buffer.readAsync(0, graph.points.byteLength)
        assertHealthy()
        return new Float32Array(bytes.buffer, bytes.byteOffset, graph.points.length).slice()
      },
      async read (frozen = false): Promise<Snapshot> {
        assertHealthy()
        const read = async (buffer: Buffer): Promise<Float32Array> => {
          const bytes = await buffer.readAsync(0, graph.points.byteLength)
          return new Float32Array(bytes.buffer, bytes.byteOffset, graph.points.length).slice()
        }
        const [firstForce, intermediate, secondForce, output] = await Promise.all([
          read(forces[0]), read(positions[1]), read(forces[1]), read(positions[frozen ? 2 : 0]),
        ])
        assertHealthy()
        return { firstForce, intermediate, secondForce, positions: output }
      },
      async measure (stage: Stage, operations = 1): Promise<Measurement> {
        assertHealthy()
        if (!Number.isInteger(operations) || operations < 1 || operations > TIMING_POLICY.maxOperations) throw new Error('Invalid batch size')
        backend.reset()
        // Prepare canonical intermediate positions/forces and final render input outside the timer.
        // Frozen ticks write their last integration to scratch slot 2, leaving slot 0 immutable.
        encodeTick(false, true); device.submit(); await backend.synchronize()
        const start = performance.now()
        for (let i = 0; i < operations; i++) encodeStage(stage, i === 0, i === operations - 1)
        device.submit(); const submitted = performance.now()
        await backend.synchronize()
        const complete = performance.now()
        const elapsed = timer ? await timer.readTimestampDuration(0, 1) : null
        return normalizeMeasurement(stage, operations, submitted - start, complete - start, elapsed, timer ? 'valid' : 'unavailable')
      },
      destroy (): void { owned.reverse().forEach(resource => resource.destroy()); buffers.forEach(buffer => buffer.destroy()); device.destroy() },
    }
    return backend
  } catch (error) { owned.reverse().forEach(resource => resource.destroy()); device.destroy(); throw error }
}
