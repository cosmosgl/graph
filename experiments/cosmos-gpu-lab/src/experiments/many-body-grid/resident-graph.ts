import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout, createDevice, createStorageRenderer, readFloats, upload, waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { graphRgb, graphRgba } from '../../runtime/palette'
import { SETTINGS as CLUSTER, type ClusterInput } from '../cluster-attraction/data'
import { createClusterWebGPU } from '../cluster-attraction/webgpu'
import type { CollisionParameters } from '../collision/data'
import { collisionPassFrame } from '../collision/hashed-grid'
import type { CollisionCellLookup } from '../collision/hashed-source'
import { createCollisionSlotsWebGPU } from '../collision/hashed-webgpu'
import { createCenterWebGPU } from '../combined-layout/center-webgpu'
import { createLinkResources, type LinkInput } from '../combined-layout/topology'
import { GRAVITY, REPULSION, SPRINGS } from '../combined-layout/data'
import type { MouseForce } from '../combined-layout/webgpu'
import type { PositionSource } from '../many-body/backend'
import { createFixture, nearLimit, type Input } from '../many-body/data'
import type { Snapshot } from '../many-body/reference'
import type { TimestampWrites } from '../many-body/timing'
import { createMouseWebGPU } from '../mouse-repulsion/webgpu'
import { packAttractors, SETTINGS as ATTRACTOR, type AttractorInput } from '../point-attractors/data'
import { createAttractorWebGPU } from '../point-attractors/webgpu'
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
  pixelRatio?: number; picking?: boolean; pointCulling?: boolean; cachedHighlight?: boolean; depthLinks?: boolean; coarseLevels?: number;
  fullForces?: {
    centerStrength: number; cluster: ClusterInput; attractor: AttractorInput; collision: CollisionParameters; collisionCells?: CollisionCellLookup;
  };
}
export type ResidentMotionSample = { points: Float32Array; normalized: Float32Array; fieldBox: Float32Array; view: Float32Array }
export const RESIDENT_STAGES = ['gravity', 'bounds and normalization', 'hierarchy and cell field', 'repulsion', 'springs and camera', 'draw'] as const
export const RESIDENT_FORCE_STAGES = ['mouse', 'centroid', 'cluster attraction', 'point attractors', 'collision'] as const
export type ResidentStage = typeof RESIDENT_STAGES[number] | typeof RESIDENT_FORCE_STAGES[number]
export type ResidentStageTimestamps = (stage: ResidentStage) => TimestampWrites

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
  readLinks(): Promise<Uint32Array>;
  positionSource(): PositionSource;
  patchPositions(first: number, values: Float32Array): void;
  setMouseRepulsion(pointer?: MouseForce): void;
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
    const hierarchy = own(await createResidentHierarchy(device, positions, samples, forces, count, REPULSION, 8, distantForce, options.coarseLevels))
    const topology = own(createLinkResources(device, input.points, graph))
    const gravityParams = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
    const springParams = own(upload(device, new Float32Array(12), Buffer.UNIFORM))
    const integrationParams = own(upload(device, new Float32Array([
      count, 0, 0, nearLimit(count, REPULSION), REPULSION.friction, REPULSION.referenceLength, 0, 0,
    ]), Buffer.UNIFORM))
    const config = options.fullForces
    if (config && (config.cluster.points !== input.points || config.attractor.points !== input.points || !Number.isFinite(config.centerStrength))) {
      throw new Error('Full forces require channels for the current point data and a finite center strength')
    }
    const extra = config && {
      center: own(await createCenterWebGPU(device, count, forces, undefined, 'linear', 'once')),
      cluster: own(await createClusterWebGPU(device, config.cluster, forces)),
      attractor: own(await createAttractorWebGPU(device, count, forces)),
      mouse: own(await createMouseWebGPU(device, forces, undefined, 'expanded')),
      collision: own(await createCollisionSlotsWebGPU(device, graph.sizes, forces, config.collision, [0, 0], undefined, config.collisionCells)),
      collisionIntegration: own(upload(device, new Float32Array([count, 0, 0, 0, 1, REPULSION.referenceLength, 0, 0]), Buffer.UNIFORM)),
      collisionSettings: config.collision,
      centerStrength: config.centerStrength,
    }
    if (extra && config) extra.attractor.update(packAttractors(config.attractor).values)
    let pointer: MouseForce | undefined
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
    const move = (pass: ComputePass, params = integrationParams): void => {
      integrate.dispatch(pass, {
        x: Math.ceil(count / 64), bindings: { positions: positions[current], forces, params, output: positions[1 - current] },
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
        const resizeCollision = extra?.collision.prepareResize(links.sizes)
        topology.update(input.points, links)
        resizeCollision?.()
        highlightValid = false
      },
      async readLinks (): Promise<Uint32Array> {
        healthy()
        if (!topology.edgeCount) return new Uint32Array()
        const bytes = await topology.links.readAsync(0, topology.edgeCount * 8)
        return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      },
      positionSource (): PositionSource { healthy(); return { device, buffer: positions[current], count } },
      patchPositions (first, values): void {
        healthy()
        if (!Number.isInteger(first) || first < 0 || values.length % 4 || first + values.length / 4 > count) {
          throw new Error('Invalid resident position patch range')
        }
        for (let i = 0; i < values.length; i += 4) {
          if (!Number.isFinite(values[i + 2]) || !Number.isFinite(values[i + 3]) ||
            (values[i + 3] <= 0.5 && (!Number.isFinite(values[i]) || !Number.isFinite(values[i + 1])))) {
            throw new Error('Invalid resident position patch values')
          }
        }
        if (values.byteLength) positions.forEach(buffer => buffer.write(values, first * 16))
        highlightValid = false
      },
      setMouseRepulsion (next): void {
        healthy()
        if (!extra) throw new Error('Resident mouse repulsion was not enabled')
        pointer = next
      },
      frame (tick, alpha, draw = true, timestamps, gridTimestamps): void {
        healthy(); hierarchy.prepare(tick, alpha)
        highlightValid = false
        const updateView = draw && autoFit
        if (updateView) viewBounds.prepare(tick)
        gravityParams.write(new Float32Array([count, alpha, GRAVITY, 0]))
        const collisionSettings = extra?.collisionSettings
        springParams.write(new Float32Array([
          SPRINGS.spring, SPRINGS.distance, 1, 1, alpha, SPRINGS.friction, SPRINGS.maxStep,
          collisionSettings?.strength ? 1 : 0, collisionSettings?.radius ?? 0, collisionSettings?.padding ?? 0, count, 0,
        ]))
        if (extra && pointer) {
          extra.mouse.prepare(count, pointer.world, pointer.strength)
          compute(pass => { extra.mouse.encode(pass, positions[current]); move(pass) }, timestamps?.('mouse'))
        }
        compute(pass => {
          gravity.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions: positions[current], params: gravityParams, forces } })
          move(pass)
        }, timestamps?.('gravity'))
        if (extra) {
          compute(pass => { extra.center.encode(pass, positions[current], alpha, extra.centerStrength); move(pass) }, timestamps?.('centroid'))
        }
        hierarchy.encodeIndex(current, timestamps?.('bounds and normalization'), gridTimestamps)
        // Measure each split pass against its own timestamp pair. The timing
        // sweep keeps the ordinary hierarchy/repulsion/springs pass intact.
        if (timestamps) {
          compute(pass => hierarchy.encodeHierarchy(pass, current), timestamps('hierarchy and cell field'))
          compute(pass => { hierarchy.encodeRepulsion(pass, current); move(pass) }, timestamps('repulsion'))
          compute(pass => {
            moveAlongLinks(pass)
            if (updateView && !extra) viewBounds.encode(pass, positions[current])
          }, timestamps('springs and camera'))
        } else {
          compute(pass => {
            hierarchy.encodeForce(pass, current); move(pass); moveAlongLinks(pass)
            if (updateView && !extra) viewBounds.encode(pass, positions[current])
          })
        }
        if (extra) {
          const { cluster, attractor, collision, collisionSettings, collisionIntegration } = extra
          cluster.prepare(alpha, CLUSTER.strength)
          compute(pass => { cluster.encode(pass, positions[current]); move(pass) }, timestamps?.('cluster attraction'))
          attractor.prepare(alpha, ATTRACTOR.strength)
          compute(pass => { attractor.encode(pass, positions[current]); move(pass) }, timestamps?.('point attractors'))
          compute(pass => {
            for (let i = 0; i < collisionSettings.iterations; i++) {
              collision.prepare(collisionPassFrame(tick * collisionSettings.iterations + i, alpha), i)
              collision.encode(pass, positions[current], i)
              move(pass, collisionIntegration)
            }
            if (updateView) viewBounds.encode(pass, positions[current])
          }, timestamps?.('collision'))
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
