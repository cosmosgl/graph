import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout, createDevice, createStorageRenderer, readFloats, upload, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { graphRgb, graphRgba } from '../../runtime/palette'
import { createLinkResources, type LinkInput } from '../combined-layout/topology'
import { GRAVITY, REPULSION, SPRINGS } from '../combined-layout/data'
import { createFixture, nearLimit, type Input } from '../many-body/data'
import type { Snapshot } from '../many-body/reference'
import type { TimestampWrites } from '../many-body/timing'
import type { GridPassTimestamps } from '../spatial-grid/resources'
import type { GraphInput } from '../weighted-links/data'
import springSource from '../weighted-links/force.wgsl?raw'
import integrationSource from '../many-body/integrate.wgsl?raw'
import type { ResidentCamera } from '../million-graph/resident-navigation'
import { createGpuBounds } from './bounds'
import { layout } from './data'
import { createResidentHierarchy } from './resident-hierarchy'
import type { DistantForce } from './resident-cell-field'
import { createResidentHighlight, RESIDENT_OWNER_WGSL } from './resident-highlight'
import { createResidentPicker } from './resident-picker'
import { createResidentPointCulling } from './resident-point-culling'
import { residentProjection } from './resident-projection'

const gravitySource = `
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<uniform> params: vec4f;
@group(0) @binding(2) var<storage, read_write> forces: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x < u32(params.x)) { forces[gid.x] = vec4f(-positions[gid.x].xy * (params.y * params.z * 0.1), 0., 0.); }
}`
const pointColor = `
  let color = select(vec3f(${graphRgb.point}), vec3f(${graphRgb.pinned}), input.flags.x > 0.5);
  return vec4f(select(color, vec3f(${graphRgb.coral}), input.flags.y > 0.5), 1.);`
const pointsSource = (compacted: boolean, owners: boolean): string => `
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
${residentProjection}
${compacted ? '@group(0) @binding(3) var<storage, read> visibleIds: array<u32>;' : ''}
${owners ? RESIDENT_OWNER_WGSL : ''}
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) flags: vec2f,
  ${owners ? '@location(2) @interpolate(flat) owner: u32,' : ''}
}
@vertex fn vertexMain(@builtin(vertex_index) v: u32, @builtin(instance_index) instance: u32) -> Vertex {
  let i = ${compacted ? 'visibleIds[instance]' : 'instance'};
  let corners = array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
  let p = positions[i]; var out: Vertex; out.position = vec4f(3.,3.,0.,1.);
  if (p.w <= 0.5) { out.position = vec4f(project(p.xy) + corners[v] * (5. * display.z / display.xy), 0., 1.); }
  out.uv = corners[v]; out.flags = vec2f(p.z, select(0., 1., f32(i) == display.w));
  ${owners ? 'out.owner = residentOwnerPoint(i, p.z);' : ''}
  return out;
}
@fragment fn fragmentMain(input: Vertex) -> @location(0) ${owners ? 'u32' : 'vec4f'} {
  if (input.flags.x <= 0.5 && dot(input.uv, input.uv) > 1.) { discard; }
  ${owners ? 'return input.owner;' : pointColor}
}`
const linksSource = (owners: boolean, depth: boolean): string => `
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
${residentProjection}
@group(0) @binding(3) var<storage, read> links: array<u32>;
@vertex fn vertexMain(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let a = positions[links[(i / 2u) * 2u]]; let b = positions[links[(i / 2u) * 2u + 1u]];
  if (a.w > 0.5 || b.w > 0.5) { return vec4f(3.,3.,0.,1.); }
  return vec4f(project(select(a.xy, b.xy, i % 2u == 1u)), ${depth ? '0.5' : '0.'}, 1.);
}
@fragment fn fragmentMain() -> @location(0) ${owners ? 'u32 { return 1u;' : `vec4f { return vec4f(${graphRgb.link}, 1.);`} }
`

export type Distribution = 'uniform' | 'clusters'
export type ResidentLayers = 'clear' | 'points' | 'links' | 'both'
type ResidentOptions = {
  pixelRatio?: number; picking?: boolean; pointCulling?: boolean; cachedHighlight?: boolean; depthLinks?: boolean;
}
export type ResidentMotionSample = { points: Float32Array; normalized: Float32Array; fieldBox: Float32Array; view: Float32Array }
export const RESIDENT_STAGES = ['gravity', 'bounds and normalization', 'hierarchy and cell field', 'repulsion', 'springs and camera', 'draw'] as const
export type ResidentStageTimestamps = (stage: typeof RESIDENT_STAGES[number]) => TimestampWrites

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
  canvas: HTMLCanvasElement, input: Input, graph: GraphInput, distantForce: DistantForce = 'per-point', options: ResidentOptions = {}
): Promise<{
  readonly device: Device;
  readonly hierarchyBytes: number;
  readonly linkBytes: number;
  readonly topologyMs: number;
  readonly linkCount: number;
  updateLinks(input: LinkInput): void;
  frame(tick: number, alpha: number, draw?: boolean, timestamps?: ResidentStageTimestamps, gridTimestamps?: GridPassTimestamps): void;
  redraw(layers?: ResidentLayers, timestamps?: TimestampWrites): void;
  redrawHighlight(timestamps?: TimestampWrites): boolean;
  readDrawnPointCount(): Promise<number>;
  readView(): Promise<Float32Array>;
  setCamera(camera: ResidentCamera): void;
  fit(): void;
  pick(x: number, y: number): Promise<number | null>;
  select(id: number | null): void;
  read(): Promise<Snapshot>;
  readPositions(): Promise<Float32Array>;
  readMotionSample(limit: number): Promise<ResidentMotionSample>;
  destroy(): void;
}> {
  const count = input.points.length / 4
  if (!Number.isInteger(count) || count < 4 || count > 1000000 || input.samples.length !== count * 2 || graph.points !== input.points) {
    throw new Error('Invalid resident graph inputs')
  }
  const ratio = options.pixelRatio ?? 1
  const { width, height } = canvas
  if (!(Number.isFinite(ratio) && ratio > 0 && width > 0 && height > 0)) throw new Error('Invalid resident viewport')
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
    const display = own(upload(device, new Float32Array([width, height, ratio, -1]), Buffer.UNIFORM))
    const picker = options.picking ? own(await createResidentPicker(device, count)) : undefined
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
    const culling = options.pointCulling
      ? own(await createResidentPointCulling(device, count, viewBuffer, display, width, height, pointsSource(false, true)))
      : undefined
    const depthLinks = !!(options.cachedHighlight && options.depthLinks)
    const highlight = options.cachedHighlight ? own(createResidentHighlight(device, width, height, display, depthLinks)) : undefined
    const pointBindings = bindingLayout(culling
      ? [
        ['positions', 'read-only-storage'], ['view', 'read-only-storage'], ['display', 'uniform'], ['visibleIds', 'read-only-storage'],
      ]
      : [['positions', 'read-only-storage'], ['view', 'read-only-storage'], ['display', 'uniform']])
    const pointRenderer = own(createStorageRenderer(
      device, pointsSource(!!culling, !!highlight), 'triangle-list', pointBindings,
      depthLinks ? { depthWriteEnabled: true, depthCompare: 'always' } : {}, undefined, highlight?.framebuffer
    ))
    const lineRenderer = own(createStorageRenderer(device, linksSource(!!highlight, depthLinks), 'line-list', bindingLayout([
      ['positions', 'read-only-storage'], ['view', 'read-only-storage'], ['display', 'uniform'], ['links', 'read-only-storage'],
    ]), depthLinks ? { depthWriteEnabled: true, depthCompare: 'less' } : {}, undefined, highlight?.framebuffer))
    await waitForGpu(device, 30000)
    let current = 0; let destroyed = false; let autoFit = true
    let highlightValid = false; let drewPoints = false
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
    const paint = (layers: ResidentLayers, timestamps?: TimestampWrites): void => {
      const withPoints = layers === 'points' || layers === 'both'
      const filtered = withPoints && culling
      const { timestampQuerySet, beginTimestampIndex, endTimestampIndex } = timestamps ?? {}
      const begin = filtered ? undefined : beginTimestampIndex
      const end = highlight ? undefined : endTimestampIndex
      if (filtered) {
        filtered.encode(positions[current], beginTimestampIndex === undefined ? undefined : { timestampQuerySet, beginTimestampIndex })
      }
      const pass = device.beginRenderPass({
        framebuffer: highlight?.framebuffer,
        clearColor: highlight ? [0, 0, 0, 0] : graphRgba.background,
        clearDepth: depthLinks ? 1 : false,
        timestampQuerySet: begin === undefined && end === undefined ? undefined : timestampQuerySet,
        beginTimestampIndex: begin,
        endTimestampIndex: end,
      })
      const bindings = { positions: positions[current], view: viewBuffer, display }
      const withLinks = layers === 'links' || layers === 'both'
      const drawLinks = (): void => {
        lineRenderer.kernel.draw(pass, {
          vertexArray: lineRenderer.vertexArray,
          vertexCount: topology.edgeCount * 2,
          bindings: { ...bindings, links: topology.links },
        })
      }
      try {
        if (withLinks && !depthLinks) drawLinks()
        if (filtered) {
          pointRenderer.kernel.drawIndirect(pass, {
            vertexArray: pointRenderer.vertexArray,
            indirectBuffer: filtered.drawArgs,
            bindings: { ...bindings, visibleIds: filtered.visibleIds },
          })
        } else if (withPoints) {
          pointRenderer.kernel.draw(pass, {
            vertexArray: pointRenderer.vertexArray,
            vertexCount: 6,
            instanceCount: count,
            bindings,
          })
        }
        // All links have the same opaque color in this resident renderer.
        if (withLinks && depthLinks) drawLinks()
      } finally { pass.end() }
      highlight?.present(endTimestampIndex === undefined ? undefined : { timestampQuerySet, endTimestampIndex })
      highlightValid = !!highlight && layers === 'both'
      drewPoints = withPoints
    }
    return {
      device,
      hierarchyBytes: hierarchy.bytes,
      linkBytes: topology.bytes,
      get topologyMs (): number { return topology.buildMs },
      get linkCount (): number { return topology.edgeCount },
      updateLinks (links): void {
        healthy()
        topology.update(input.points, links)
        highlightValid = false
      },
      frame (tick, alpha, draw = true, timestamps, gridTimestamps): void {
        healthy(); hierarchy.prepare(tick, alpha)
        highlightValid = false
        const updateView = draw && autoFit
        if (updateView) viewBounds.prepare(tick)
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
            if (updateView) viewBounds.encode(pass, positions[current])
          }, timestamps('springs and camera'))
        } else {
          compute(pass => {
            hierarchy.encodeForce(pass, current); move(pass); moveAlongLinks(pass)
            if (updateView) viewBounds.encode(pass, positions[current])
          })
        }
        if (draw) paint('both', timestamps?.('draw'))
        device.submit()
      },
      redraw (layers = 'both', timestamps): void { healthy(); paint(layers, timestamps); device.submit() },
      redrawHighlight (timestamps): boolean {
        healthy()
        const cached = !!highlight && highlightValid
        if (cached) highlight.present(timestamps)
        else paint('both', timestamps)
        device.submit()
        return cached
      },
      async readDrawnPointCount (): Promise<number> {
        healthy()
        return drewPoints ? (await culling?.drawnCount() ?? count) : 0
      },
      readView (): Promise<Float32Array> { healthy(); return readFloats(viewBuffer) },
      setCamera ({ x, y, zoom }): void {
        healthy()
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) throw new Error('Invalid resident camera')
        const side = height / (ratio * zoom * 1.1)
        viewBuffer.write(new Float32Array([x - side * 0.5, y - side * 0.5, side, 0]))
        autoFit = false
        highlightValid = false
      },
      fit (): void {
        healthy()
        // Center the padding around the graph and keep this view for later ticks.
        viewBounds.prepare(0, [0.5, 0.5])
        compute(pass => viewBounds.encode(pass, positions[current]))
        device.submit()
        autoFit = false
        highlightValid = false
      },
      pick (x, y): Promise<number | null> {
        healthy()
        if (!picker) throw new Error('Point picking is disabled')
        return picker.pick(positions[current], viewBuffer, x, y, width, height, ratio)
      },
      select (id): void {
        healthy()
        display.write(new Float32Array([width, height, ratio, id ?? -1]))
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
