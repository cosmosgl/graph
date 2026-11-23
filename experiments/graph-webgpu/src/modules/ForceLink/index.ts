import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import type { GraphConfigInterface } from '@/graph/config'
import type { GraphData, LinksByPoint } from '@/graph/modules/GraphData'
import type { Store } from '@/graph/modules/Store'
import { resourceScope } from '../Shared/resource-scope'
import { kernel, upload } from '../Shared/compute'
import source from './force-link.wgsl?raw'

type Scope = ReturnType<typeof resourceScope>
type Direction = {offsets: Buffer; edges: Buffer}
interface LinkForce {
  updateTopology(data: GraphData): void;
  prepare(config: GraphConfigInterface): void;
  encode(pass: ComputePass, current: () => Buffer, sizes: Buffer, forces: Buffer, integrate: (pass: ComputePass) => void): void;
  releaseTopology(): void;
}

export function createSpringKernel (device: Device, scope: Scope): Kernel {
  const read = 'read-only-storage'
  return kernel(device, scope, source, 'main',
    [['positions', read], ['offsets', read], ['edges', read], ['sizes', read], ['params', 'uniform'], ['forces', 'storage']])
}

/** CSR order, degrees, per-link weights and defaults come from the public graph data model. */
function springEdges (group: LinksByPoint, data: GraphData, store: Store): Uint32Array {
  const edges = new Uint32Array(group.neighbors.length * 4)
  const props = new Float32Array(edges.buffer)
  const degrees = data.degree!
  for (let i = 0; i < group.offsets.length - 1; i++) {
    for (let j = group.offsets[i]!; j < group.offsets[i + 1]!; j++) {
      const other = group.neighbors[j]!
      const degree = degrees[i]!; const otherDegree = degrees[other]!
      let strength = data.linkStrength?.[group.linkIndices[j]!]
      if (strength === undefined || !Number.isFinite(strength) || strength < 0) {
        strength = 1 / Math.max(1, Math.min(degree, otherDegree))
      }
      edges[4 * j] = other
      props[4 * j + 1] = otherDegree / (degree + otherDegree)
      props[4 * j + 2] = Math.sqrt(strength)
      props[4 * j + 3] = store.getRandomFloat(0, 1)
    }
  }
  return edges
}

export function createLinkForce (device: Device, scope: Scope, count: number, store: Store, program: Kernel): LinkForce {
  const groups = Math.ceil(count / 64)
  const params = scope.own(upload(device, new Float32Array(12), Buffer.UNIFORM))
  let topology = resourceScope()
  let directions: Direction[] = []
  return {
    updateTopology (data: GraphData): void {
      const next = resourceScope()
      try {
        const newDirections: typeof directions = []
        for (const group of [data.linksBySource, data.linksByTarget]) {
          if (!group?.neighbors.length) continue
          newDirections.push({
            offsets: next.own(upload(device, group.offsets)),
            edges: next.own(upload(device, springEdges(group, data, store))),
          })
        }
        topology.destroy(); topology = next; directions = newDirections
      } catch (error) { next.destroy(); throw error }
    },
    prepare (config): void {
      if (!directions.length) return
      params.write(new Float32Array([config.simulationLinkSpring, config.simulationLinkDistance,
        ...config.simulationLinkDistRandomVariationRange, store.alpha, config.simulationFriction, store.stepGuard,
        config.simulationCollision ? 1 : 0, config.simulationCollisionRadius ?? 0, config.simulationCollisionPadding, count, 0]))
    },
    encode (pass, current, sizes, forces, integrate): void {
      for (const direction of directions) {
        program.dispatch(pass, { x: groups, bindings: { positions: current(), ...direction, sizes, params, forces } })
        integrate(pass)
      }
    },
    releaseTopology (): void {
      topology.destroy()
      topology = resourceScope()
      directions = []
    },
  }
}
