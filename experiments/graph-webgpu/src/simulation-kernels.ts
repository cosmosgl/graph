import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import { getFriction, type GraphConfigInterface } from '@/graph/config'
import type { GraphData } from '@/graph/modules/GraphData'
import type { Store } from '@/graph/modules/Store'
import { ForceAttractor } from './modules/ForceAttractor'
import { ForceCenter, createCenterKernel, createCentroidKernel } from './modules/ForceCenter'
import { ForceCollision } from './modules/ForceCollision'
import { ForceGravity, createGravityKernel } from './modules/ForceGravity'
import { ForceLink, createSpringKernel } from './modules/ForceLink'
import { ForceManyBody, createRepulsionKernel } from './modules/ForceManyBody'
import { ForceMouse } from './modules/ForceMouse'
import { Clusters } from './modules/Clusters'
import { resourceScope } from './modules/Shared/resource-scope'
import { kernel, type Decl, upload } from './modules/Shared/compute'
import gather from './modules/Shared/gather-positions.wgsl?raw'
import bounds from './modules/Shared/bounds.wgsl?raw'
import integration from './modules/Shared/integrate-positions.wgsl?raw'

const uniformUsage = Buffer.UNIFORM
const read = 'read-only-storage'; const write = 'storage'; const uniform = 'uniform'

export function asFloats (bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

export type Programs = Record<'gravity' | 'center' | 'gather' | 'centroid' | 'bounds' | 'repulsion' | 'spring' | 'integrate', Kernel> & { destroy(): void }

export function createPrograms (device: Device): Programs {
  const scope = resourceScope()
  const make = (source: string, entry: string, declarations: Decl[]): Kernel => kernel(device, scope, source, entry, declarations)
  try {
    return {
      gravity: createGravityKernel(device, scope),
      center: createCenterKernel(device, scope),
      gather: make(gather, 'gather', [['positions', read], ['output', write], ['ids', read, 4]]),
      centroid: createCentroidKernel(device, scope),
      bounds: make(bounds, 'main', [['values', read], ['partials', write], ['params', uniform]]),
      repulsion: createRepulsionKernel(device, scope),
      spring: createSpringKernel(device, scope),
      integrate: make(integration, 'main', [['positions', read], ['forces', read], ['params', uniform], ['output', write]]),
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}

export interface SimulationState {
  readonly repulsionSampling: ForceManyBody['sampling'];
  count: number;
  positions: [Buffer, Buffer];
  current(): Buffer;
  updateSamples(): void;
  restartOccupancyMeasurement(): void;
  updateTopology(data: GraphData): void;
  updateSizes(data: GraphData): void;
  updateClusters(data: GraphData): void;
  updateAttractors(data: GraphData): void;
  readClusters(): Promise<number[]>;
  readBounds(): Promise<Float32Array>;
  applyPointer(config: GraphConfigInterface, x: number, y: number): void;
  step(config: GraphConfigInterface, measureOccupancy: boolean): void;
  releaseForces(): void;
  destroy(): void;
}

export function createState (device: Device, packed: Float32Array, store: Store, programs: Programs): SimulationState {
  const scope = resourceScope()
  const count = packed.length / 4
  const positionBytes = packed.byteLength
  const groups = Math.ceil(count / 64)
  if (packed.byteLength > device.limits.maxStorageBufferBindingSize || groups > device.limits.maxComputeWorkgroupsPerDimension) {
    throw new Error('The graph exceeds this WebGPU device’s storage buffer or compute dispatch limit.')
  }
  try {
    const own = scope.own
    const positions: [Buffer, Buffer] = [own(upload(device, packed)), own(upload(device, packed))]

    const levels: Array<{ groups: number; output: Buffer; centroidParams: Buffer; boundsParams: Buffer }> = []
    for (let n = count; ; n = Math.ceil(n / 256)) {
      const groups = Math.ceil(n / 256)
      const output = own(device.createBuffer({ byteLength: groups * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
      const first = n === count
      const boundsParams = own(upload(device, new Uint32Array([n, first ? 0 : 1, 0, 0]), uniformUsage))
      const centroidParams = own(upload(device, new Uint32Array([n, first ? 1 : 0, 0, 0]), uniformUsage))
      levels.push({ groups, output, boundsParams, centroidParams })
      if (groups === 1) break
    }
    const reduce = (pass: ComputePass, source: Buffer, kind: 'bounds' | 'centroid'): Buffer => {
      for (const { groups, output, boundsParams, centroidParams } of levels) {
        const bindings: Record<string, Buffer> = kind === 'bounds'
          ? { values: source, partials: output, params: boundsParams }
          : { input: source, output, params: centroidParams }
        programs[kind].dispatch(pass, { x: groups, bindings })
        source = output
      }
      return source
    }
    const gravity = new ForceGravity(device, scope, programs.gravity, groups, store)
    const center = new ForceCenter(device, scope, programs.center, groups)
    const integrationParams = own(upload(device, new Float32Array(8), uniformUsage))
    const collisionIntegrator = own(upload(device, new Float32Array(8), uniformUsage))
    const links = new ForceLink(device, scope, count, store, programs.spring)
    const manyBody = new ForceManyBody(device, count, store, programs.repulsion)
    let forces: Buffer | undefined
    let sizes: Buffer | undefined
    let maxSize = 0
    let attractors: ForceAttractor | undefined
    let clusters: Clusters | undefined
    let pointer: ForceMouse | undefined
    let collision: ForceCollision | undefined
    let current: 0 | 1 = 0
    const run = (encode: (pass: ComputePass) => void): void => {
      const encoder = device.createCommandEncoder()
      try {
        const pass = encoder.beginComputePass({})
        try { encode(pass) } finally { pass.end() }
        device.submit(encoder.finish())
      } finally { encoder.destroy() }
    }
    const forceBuffer = (): Buffer => {
      forces ??= device.createBuffer({ byteLength: positionBytes, usage: Buffer.STORAGE })
      return forces
    }
    const integrate = (pass: ComputePass, params = integrationParams): void => {
      const next = current === 0 ? 1 : 0
      programs.integrate.dispatch(pass, { x: groups, bindings: { positions: positions[current], forces: forceBuffer(), params, output: positions[next] } })
      current = next
    }
    const releaseForces = (): void => {
      forces?.destroy()
      sizes?.destroy()
      pointer?.destroy()
      collision?.destroy()
      attractors?.destroy()
      manyBody.destroy()
      links.releaseTopology()
      forces = sizes = undefined
      pointer = collision = attractors = undefined
    }
    return {
      get repulsionSampling (): ForceManyBody['sampling'] { return manyBody.sampling },
      releaseForces,
      count,
      positions,
      current: (): Buffer => positions[current],
      updateSamples: () => manyBody.updateSamples(),
      restartOccupancyMeasurement: () => manyBody.restartOccupancyMeasurement(),
      updateTopology: data => links.updateTopology(data),
      updateSizes (data: GraphData): void {
        // Size collision cells from resolved diameters so an unused default preserves the neighbor samples.
        maxSize = 0
        const values = Float32Array.from({ length: count }, (_, i) => {
          const size = data.getResolvedPointSize(i)
          maxSize = Math.max(size, maxSize)
          return size
        })
        if (sizes) sizes.write(values)
        else sizes = upload(device, values)
      },
      updateClusters (data: GraphData): void {
        const next = Clusters.create(device, data)
        clusters?.destroy()
        clusters = next
      },
      updateAttractors (data: GraphData): void {
        const next = ForceAttractor.create(device, data)
        attractors?.destroy()
        attractors = next
      },
      async readClusters (): Promise<number[]> {
        const source = clusters
        if (!source) return []
        run(pass => source.reducePositions(pass, positions[current]))
        const sums = asFloats(await source.aggregates.readAsync())
        if (clusters !== source) return []
        return source.decodeCentroids(sums)
      },
      applyPointer (cfg: GraphConfigInterface, x: number, y: number): void {
        pointer ??= new ForceMouse(device, count)
        const active = pointer
        const forces = forceBuffer()
        const friction = getFriction(cfg.simulationFriction)
        integrationParams.write(new Float32Array([count, store.alpha, 0, 0, friction, store.stepGuard, 0, 0]))
        run(pass => {
          active.encode(pass, positions[current], forces, x, y, cfg.simulationRepulsionFromMouse)
          integrate(pass)
        })
      },
      async readBounds (): Promise<Float32Array> {
        let result!: Buffer
        run(pass => { result = reduce(pass, positions[current], 'bounds') })
        return asFloats(await result.readAsync())
      },
      step (cfg: GraphConfigInterface, measureOccupancy: boolean): void {
        const forces = forceBuffer()
        const alpha = store.alpha
        const nearLimit = manyBody.nearLimit
        const friction = getFriction(cfg.simulationFriction)
        integrationParams.write(new Float32Array([count, alpha, cfg.simulationRepulsion, nearLimit, friction, store.stepGuard, 0, 0]))
        manyBody.prepare(cfg, measureOccupancy)
        if (cfg.simulationLinkSpring) links.prepare(cfg)
        if (cfg.simulationCollision) {
          collision ??= new ForceCollision(device, count, store)
          collisionIntegrator.write(new Float32Array([count, alpha, 0, 0, 1, store.stepGuard, 0, 0]))
        }
        run(pass => {
          if (cfg.simulationGravity) {
            gravity.encode(pass, positions[current], forces, cfg.simulationGravity)
            integrate(pass)
          }
          if (cfg.simulationCenter) {
            const centroid = reduce(pass, positions[current], 'centroid')
            center.encode(pass, positions[current], forces, centroid, alpha, cfg.simulationCenter)
            integrate(pass)
          }
          if (manyBody.encode(pass, positions[current], forces, integrationParams, cfg, reduce, measureOccupancy)) integrate(pass)
          if (cfg.simulationLinkSpring && sizes) links.encode(pass, () => positions[current], sizes, forces, integrate)
          if (clusters && cfg.simulationCluster) {
            clusters.encode(pass, positions[current], forces, alpha, cfg.simulationCluster)
            integrate(pass)
          }
          if (attractors && cfg.simulationAttractor) {
            attractors.encode(pass, positions[current], forces, alpha, cfg.simulationAttractor)
            integrate(pass)
          }
          if (collision && sizes && cfg.simulationCollision) {
            const requested = cfg.simulationCollisionIterations
            const iterations = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 1
            for (let i = 0; i < iterations; i++) {
              collision.encode(pass, positions[current], sizes, forces, cfg, maxSize, i)
              integrate(pass, collisionIntegrator)
            }
          }
        })
        manyBody.collectOccupancy()
      },
      destroy (): void {
        releaseForces()
        clusters?.destroy()
        scope.destroy()
      },
    }
  } catch (error) { scope.destroy(); throw error }
}
