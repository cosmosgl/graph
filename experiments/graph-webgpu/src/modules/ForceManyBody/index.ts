import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import type { GraphConfigInterface } from '@/graph/config'
import type { Store } from '@/graph/modules/Store'
import { getFinestGridSize } from '@/graph/modules/Shared/cell-slots'
import { resourceScope } from '../Shared/resource-scope'
import { kernel, upload, type Decl } from '../Shared/compute'
import direct from './force-direct.wgsl?raw'
import hierarchy from './hierarchy.wgsl?raw'

const read = 'read-only-storage'; const write = 'storage'; const uniform = 'uniform'
type Scope = ReturnType<typeof resourceScope>

export function createRepulsionKernel (device: Device, scope: Scope): Kernel {
  return kernel(device, scope, direct, 'direct', [['positions', read], ['samples', read], ['params', uniform], ['forces', write]])
}

interface RepulsionTree {
  encode(pass: ComputePass, positions: Buffer, bounds: Buffer, samples: Buffer, forces: Buffer,
    alpha: number, strength: number, theta: number, nearLimit: number): void;
  destroy(): void;
}

function createTree (device: Device, count: number): RepulsionTree {
  const scope = resourceScope()
  const make = (entry: string, decl: Decl[]): Kernel => kernel(device, scope, hierarchy, entry, decl)
  const s = scope.own
  try {
    const width = getFinestGridSize(count); const depth = Math.log2(width)
    const leafCount = width * width
    const leaves = s(device.createBuffer({ byteLength: leafCount * 12, usage: Buffer.STORAGE }))
    const tree = s(device.createBuffer({ byteLength: (leafCount * 4 - 1) / 3 * 16, usage: Buffer.STORAGE }))
    const settings = s(upload(device, new Uint32Array(8), uniformUsage))
    const levels = Array.from({ length: depth }, (_, index) => {
      const nodes = 4 ** (depth - index - 1)
      return { nodes, level: s(upload(device, new Uint32Array([(nodes - 1) / 3, nodes, 0, 0]), uniformUsage)) }
    })
    const clear = make('clearLeaves', [['leaves', write, 2]])
    const place = make('placePoints', [['positions', read, 0], ['bounds', read, 1], ['leaves', write, 2], ['settings', uniform, 4]])
    const leaf = make('leafCentroids', [['bounds', read, 1], ['leaves', write, 2], ['tree', write, 3], ['settings', uniform, 4]])
    const merge = make('mergeLevel', [['tree', write, 3], ['level', uniform, 5]])
    const repulse = make('repulse', [['positions', read, 0], ['bounds', read, 1], ['tree', write, 3],
      ['settings', uniform, 4], ['samples', read, 6], ['forces', write, 7]])
    const words = new Uint32Array([count, width, depth, Math.min(65535, Math.floor(0x7fffffff / count)), 0, 0, 0, 0])
    const floats = new Float32Array(words.buffer)
    return {
      encode (pass: ComputePass, positions: Buffer, bounds: Buffer, samples: Buffer, forces: Buffer,
        alpha: number, strength: number, theta: number, nearLimit: number): void {
        floats.set([alpha, strength, Math.max(0.01, theta), nearLimit], 4)
        settings.write(words)
        clear.dispatch(pass, { x: Math.ceil(leafCount / 64), bindings: { leaves } })
        place.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, bounds, leaves, settings } })
        leaf.dispatch(pass, { x: Math.ceil(leafCount / 64), bindings: { bounds, leaves, tree, settings } })
        for (const { nodes, level } of levels) merge.dispatch(pass, { x: Math.ceil(nodes / 64), bindings: { tree, level } })
        repulse.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, bounds, tree, settings, samples, forces } })
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
const uniformUsage = Buffer.UNIFORM

type ReduceBounds = (pass: ComputePass, positions: Buffer, kind: 'bounds') => Buffer
interface ManyBody {
  readonly nearLimit: number;
  updateSamples(): void;
  prepare(): void;
  encode(pass: ComputePass, positions: Buffer, forces: Buffer, params: Buffer, config: GraphConfigInterface, reduce: ReduceBounds): boolean;
  destroy(): void;
}

export function createManyBody (device: Device, count: number, store: Store, program: Kernel): ManyBody {
  const groups = Math.ceil(count / 64)
  const width = getFinestGridSize(count)
  let samples: Buffer | undefined
  let tree: RepulsionTree | undefined
  return {
    get nearLimit (): number { return store.kickSpan / width },
    updateSamples (): void {
      // The reference consumes two samples for every slot of its square position texture
      // before assigning the spring rest lengths. Keep seeded layouts reproducible,
      // including for non-square point counts and for a later re-enable of repulsion.
      const textureSlots = Math.ceil(Math.sqrt(count)) ** 2
      const jitter = new Float32Array(count * 2)
      for (let i = 0; i < textureSlots; i++) {
        const x = store.getRandomFloat(-1, 1) * 0.00001
        const y = store.getRandomFloat(-1, 1) * 0.00001
        if (i < count) {
          jitter[2 * i] = x
          jitter[2 * i + 1] = y
        }
      }
      if (samples) samples.write(jitter)
      else samples = upload(device, jitter)
    },
    prepare (): void {
      if (count > 4096) tree ??= createTree(device, count)
    },
    encode (pass, positions, forces, params, config, reduce): boolean {
      if (!samples || count < 2) return false
      if (tree) {
        tree.encode(pass, positions, reduce(pass, positions, 'bounds'), samples, forces,
          store.alpha, config.simulationRepulsion, config.simulationRepulsionTheta, store.kickSpan / width)
      } else {
        program.dispatch(pass, { x: groups, bindings: { positions, samples, params, forces } })
      }
      return true
    },
    destroy (): void {
      samples?.destroy()
      tree?.destroy()
      samples = tree = undefined
    },
  }
}
