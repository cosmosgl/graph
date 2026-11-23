import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { GraphData } from '@/graph/modules/GraphData'
import { resourceScope } from '../Shared/resource-scope'
import { kernel, upload } from '../Shared/compute'
import type { ForcePass } from '../Shared/force-pass'
import arithmetic from '../Shared/attraction-arithmetic.wgsl?raw'
import clusterSource from './force-cluster.wgsl?raw'
import centroids from './centroids.wgsl?raw'

const read = 'read-only-storage'
const write = 'storage'
const uniform = 'uniform'
type Attraction = ForcePass<[forces: Buffer, alpha: number, strength: number]>
type ClusterForce = Attraction & {
  aggregates: Buffer;
  decodeCentroids(sums: Float32Array): number[];
  reducePositions(pass: ComputePass, positions: Buffer): void;
}

export function createClusters (device: Device, data: GraphData): ClusterForce | undefined {
  const raw = data.pointClusters
  if (!raw) return undefined
  const mapping = new Map<number, number>()
  const membership = Uint32Array.from(raw, id => {
    if (id === undefined || !Number.isSafeInteger(id) || id < 0) return 0xffffffff
    if (!mapping.has(id)) mapping.set(id, mapping.size)
    return mapping.get(id)!
  })
  const groups = mapping.size
  if (!groups) return undefined
  const offset = new Uint32Array(groups + 1)
  for (const id of membership) if (id < groups) offset[id + 1]!++
  for (let i = 0; i < groups; i++) offset[i + 1]! += offset[i]!
  const ids = new Uint32Array(offset[groups]!)
  const cursors = offset.slice()
  for (const [i, group] of membership.entries()) {
    if (group < groups) ids[cursors[group]!++] = i
  }
  const targetData = new Float32Array(groups * 4)
  for (const [id, i] of mapping) {
    const x = data.clusterPositions?.[id * 2]; const y = data.clusterPositions?.[id * 2 + 1]
    if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) targetData.set([x, y, 1, 0], 4 * i)
  }
  const scope = resourceScope()
  try {
    const own = scope.own
    const aggregates = own(device.createBuffer({ byteLength: groups * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const indices = own(upload(device, ids)); const offsets = own(upload(device, offset))
    const members = own(upload(device, membership)); const targets = own(upload(device, targetData))
    const strengths = own(upload(device, data.clusterStrength ?? new Float32Array(membership.length).fill(1)))
    const params = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
    const reduce = kernel(device, scope, centroids, 'main', [['positions', read], ['ids', read], ['offsets', read], ['aggregates', write]])
    const pull = kernel(device, scope, arithmetic + clusterSource, 'main',
      [['positions', read], ['aggregates', read], ['membership', read], ['targets', read],
        ['strengths', read], ['forces', write], ['params', uniform]])
    const reducePositions = (pass: ComputePass, positions: Buffer): void => {
      reduce.dispatch(pass, { x: Math.min(groups, 65535), y: Math.ceil(groups / 65535), bindings: { positions, ids: indices, offsets, aggregates } })
    }
    return {
      reducePositions,
      aggregates,
      decodeCentroids (sums): number[] {
        let groupCount = 0
        for (const id of mapping.keys()) groupCount = Math.max(groupCount, id + 1)
        if (groupCount * 8 > device.limits.maxStorageBufferBindingSize) {
          throw new RangeError('Cluster index exceeds this device’s supported position array size.')
        }
        const result = new Array<number>(2 * groupCount).fill(NaN)
        for (const [id, i] of mapping) {
          const n = sums[i * 4 + 2]!
          result[id * 2] = sums[i * 4]! / n
          result[id * 2 + 1] = sums[i * 4 + 1]! / n
        }
        return result
      },
      encode (pass: ComputePass, positions: Buffer, forces: Buffer, alpha: number, strength: number): void {
        reducePositions(pass, positions)
        params.write(new Float32Array([membership.length, alpha, strength, 0]))
        const bindings = { positions, aggregates, membership: members, targets, strengths, forces, params }
        pull.dispatch(pass, { x: Math.ceil(membership.length / 64), bindings })
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
