import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout, createDevice, createStorageRenderer, readFloats, upload, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { graphRgb, graphRgba } from '../../runtime/palette'
import { createLinkResources } from '../combined-layout/topology'
import { GRAVITY, REPULSION, SPRINGS } from '../combined-layout/data'
import { createFixture, nearLimit, type Input } from '../many-body/data'
import type { Snapshot } from '../many-body/reference'
import type { TimestampWrites } from '../many-body/timing'
import type { GridPassTimestamps } from '../spatial-grid/resources'
import type { GraphInput } from '../weighted-links/data'
import springSource from '../weighted-links/force.wgsl?raw'
import integrationSource from '../many-body/integrate.wgsl?raw'
import { createGpuBounds } from './bounds'
import { layout } from './data'
import { createResidentHierarchy } from './resident-hierarchy'
import type { DistantForce } from './resident-cell-field'

const gravitySource = `
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<uniform> params: vec4f;
@group(0) @binding(2) var<storage, read_write> forces: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x < u32(params.x)) { forces[gid.x] = vec4f(-positions[gid.x].xy * (params.y * params.z * 0.1), 0., 0.); }
}`
const pointsSource = `
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> view: vec4f;
fn project(point: vec2f) -> vec2f {
  let center = view.xy + vec2f(view.z * 0.5);
  return (point - center) * vec2f(2. / (view.z * 1.1 * (480. / 340.)), 2. / (view.z * 1.1));
}
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pinned: f32 }
@vertex fn vertexMain(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Vertex {
  let corners = array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
  let p = positions[i]; var out: Vertex; out.position = vec4f(3.,3.,0.,1.);
  if (p.w <= 0.5) { out.position = vec4f(project(p.xy) + corners[v] * vec2f(5. / 480., 5. / 340.), 0., 1.); }
  out.uv = corners[v]; out.pinned = p.z; return out;
}
@fragment fn fragmentMain(input: Vertex) -> @location(0) vec4f {
  if (input.pinned <= 0.5 && dot(input.uv, input.uv) > 1.) { discard; }
  return vec4f(select(vec3f(${graphRgb.point}), vec3f(${graphRgb.pinned}), input.pinned > 0.5), 1.);
}`
const linksSource = `
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> links: array<u32>;
@group(0) @binding(2) var<storage, read> view: vec4f;
@vertex fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let a = positions[links[(i / 2u) * 2u]]; let b = positions[links[(i / 2u) * 2u + 1u]];
  if (a.w > 0.5 || b.w > 0.5) { return vec4f(3.,3.,0.,1.); }
  let p = select(a.xy, b.xy, i % 2u == 1u); let center = view.xy + vec2f(view.z * 0.5);
  return vec4f((p - center) * vec2f(2. / (view.z * 1.1 * (480. / 340.)), 2. / (view.z * 1.1)), 0., 1.);
}
@fragment fn fragmentMain() -> @location(0) vec4f { return vec4f(${graphRgb.link}, 1.); }
`

export type Distribution = 'uniform' | 'clusters'
export type ResidentMotionSample = { points: Float32Array; normalized: Float32Array; fieldBox: Float32Array; view: Float32Array }
export const RESIDENT_STAGES = ['gravity', 'bounds and normalization', 'hierarchy and cell field', 'repulsion', 'springs and camera', 'draw'] as const
type ResidentStageTimestamps = (stage: typeof RESIDENT_STAGES[number]) => TimestampWrites

export function createResidentChain (count: number, distribution: Distribution = 'uniform'): { input: Input; graph: GraphInput } {
  if (!Number.isInteger(count) || count < 4 || count > 1000000) throw new Error('Expected 4–1,000,000 points')
  const input = createFixture(distribution, count)
  input.points[2] = 1
  // Keep the absent position finite so both links touching it can be clipped.
  input.points[7] = 1
  const links = new Float32Array((count - 1) * 2)
  for (let i = 1; i < count; i++) { links[(i - 1) * 2] = i - 1; links[(i - 1) * 2 + 1] = i }
  return { input, graph: { points: input.points, links, weights: new Float32Array(count - 1).fill(1), sizes: new Float32Array(count).fill(2) } }
}

// Lab-only moving graph with GPU bounds, hierarchy, force, integration and
// drawing. Static point/link inputs and the link CSR topology are prepared once.
export async function createResidentGraph (
  canvas: HTMLCanvasElement, input: Input, graph: GraphInput, distantForce: DistantForce = 'per-point'
): Promise<{
  readonly device: Device;
  readonly hierarchyBytes: number;
  readonly linkBytes: number;
  readonly topologyMs: number;
  frame(tick: number, alpha: number, draw?: boolean, timestamps?: ResidentStageTimestamps, gridTimestamps?: GridPassTimestamps): void;
  read(): Promise<Snapshot>;
  readPositions(): Promise<Float32Array>;
  readMotionSample(limit: number): Promise<ResidentMotionSample>;
  destroy(): void;
}> {
  const count = input.points.length / 4
  if (!Number.isInteger(count) || count < 4 || count > 1000000 || input.samples.length !== count * 2 || graph.points !== input.points) {
    throw new Error('Invalid resident graph inputs')
  }
  let failure = ''
  const device = await createDevice('webgpu', canvas, true, error => { failure = error.message })
  const scope = resourceScope(); const own = scope.own
  try {
    const positions = [own(upload(device, input.points)), own(upload(device, input.points))]
    const samples = own(upload(device, input.samples))
    const forces = own(device.createBuffer({ byteLength: count * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const hierarchy = own(await createResidentHierarchy(device, positions, samples, forces, count, REPULSION, 8, distantForce))
    const topology = own(createLinkResources(device, input.points, graph))
    const gravityParams = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
    const springParams = own(upload(device, new Float32Array(12), Buffer.UNIFORM))
    const integrationParams = own(upload(device, new Float32Array([
      count, 0, 0, nearLimit(count, REPULSION), REPULSION.friction, REPULSION.referenceLength, 0, 0,
    ]), Buffer.UNIFORM))
    const viewBuffer = own(upload(device, new Float32Array(4)))
    const viewBounds = own(await createGpuBounds(device, count, layout(count).finest, viewBuffer))
    const gravity = own(await Kernel.createAsync(device, {
      source: gravitySource,
      shaderLayout: { bindings: bindingLayout([['positions', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage']]) },
    }))
    const springs = own(await Kernel.createAsync(device, {
      source: springSource,
      shaderLayout: {
        bindings: bindingLayout([
          ['positions', 'read-only-storage'], ['offsets', 'read-only-storage'], ['edges', 'read-only-storage'],
          ['sizes', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
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
    const pointRenderer = own(createStorageRenderer(device, pointsSource, 'triangle-list', bindingLayout([
      ['positions', 'read-only-storage'], ['view', 'read-only-storage'],
    ])))
    const lineRenderer = own(createStorageRenderer(device, linksSource, 'line-list', bindingLayout([
      ['positions', 'read-only-storage'], ['links', 'read-only-storage'], ['view', 'read-only-storage'],
    ])))
    await waitForGpu(device, 30000)
    let current = 0; let destroyed = false
    const healthy = (): void => { if (destroyed || device.isLost || failure) throw new Error(failure || 'GPU graph unavailable') }
    const move = (pass: ComputePass): void => {
      integrate.dispatch(pass, {
        x: Math.ceil(count / 64), bindings: { positions: positions[current], forces, params: integrationParams, output: positions[1 - current] },
      })
      current = 1 - current
    }
    const compute = (work: (pass: ComputePass) => void, timestamps?: TimestampWrites): void => {
      const pass = device.beginComputePass(timestamps)
      try { work(pass) } finally { pass.end() }
    }
    const moveAlongLinks = (pass: ComputePass): void => {
      for (let side = 0; side < 2; side++) {
        springs.dispatch(pass, {
          x: Math.ceil(count / 64),
          bindings: {
            positions: positions[current],
            offsets: topology.offsets[side],
            edges: topology.edges[side],
            sizes: topology.sizes,
            params: springParams,
            forces,
          },
        })
        move(pass)
      }
    }
    return {
      device,
      hierarchyBytes: hierarchy.bytes,
      linkBytes: topology.bytes,
      topologyMs: topology.buildMs,
      frame (tick, alpha, draw = true, timestamps, gridTimestamps): void {
        healthy(); hierarchy.prepare(tick, alpha)
        viewBounds.prepare(tick)
        gravityParams.write(new Float32Array([count, alpha, GRAVITY, 0]))
        springParams.write(new Float32Array([SPRINGS.spring, SPRINGS.distance, 1, 1, alpha, SPRINGS.friction, SPRINGS.maxStep, 0, 0, 0, count, 0]))
        compute(pass => {
          gravity.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions: positions[current], params: gravityParams, forces } })
          move(pass)
        }, timestamps?.('gravity'))
        hierarchy.encodeIndex(current, timestamps?.('bounds and normalization'), gridTimestamps)
        // Measure each split pass against its own timestamp pair. The timing
        // sweep keeps the ordinary hierarchy/repulsion/springs pass intact.
        if (timestamps) {
          compute(pass => hierarchy.encodeHierarchy(pass, current), timestamps('hierarchy and cell field'))
          compute(pass => { hierarchy.encodeRepulsion(pass, current); move(pass) }, timestamps('repulsion'))
          compute(pass => {
            moveAlongLinks(pass)
            if (draw) viewBounds.encode(pass, positions[current])
          }, timestamps('springs and camera'))
        } else {
          compute(pass => {
            hierarchy.encodeForce(pass, current); move(pass); moveAlongLinks(pass)
            if (draw) viewBounds.encode(pass, positions[current])
          })
        }
        if (draw) {
          const pass = device.beginRenderPass({ clearColor: graphRgba.background, clearDepth: false, ...timestamps?.('draw') })
          try {
            lineRenderer.kernel.draw(pass, {
              vertexArray: lineRenderer.vertexArray,
              vertexCount: topology.edgeCount * 2,
              bindings: { positions: positions[current], links: topology.links, view: viewBuffer },
            })
            pointRenderer.kernel.draw(pass, {
              vertexArray: pointRenderer.vertexArray,
              vertexCount: 6,
              instanceCount: count,
              bindings: { positions: positions[current], view: viewBuffer },
            })
          } finally { pass.end() }
        }
        device.submit()
      },
      async read (): Promise<Snapshot> {
        healthy(); await waitForGpu(device, 30000)
        return { positions: await readFloats(positions[current]), forces: await readFloats(forces) }
      },
      readPositions (): Promise<Float32Array> { healthy(); return readFloats(positions[current]) },
      async readMotionSample (limit): Promise<ResidentMotionSample> {
        healthy()
        if (!Number.isInteger(limit) || limit < 1 || limit > count) throw new Error('Invalid motion sample size')
        const [points, normalized, fieldBox, view] = await Promise.all([
          readFloats(positions[current], limit * 16), hierarchy.readCellCenters(limit), hierarchy.readBounds(), readFloats(viewBuffer),
        ])
        return { points, normalized, fieldBox, view }
      },
      destroy (): void { if (!destroyed) { destroyed = true; scope.destroy(); device.destroy() } },
    }
  } catch (error) { scope.destroy(); device.destroy(); throw error }
}
