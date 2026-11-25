import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
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

export class Clusters implements Attraction {
  public readonly aggregates: Buffer
  private readonly scope = resourceScope()
  private readonly count: number
  private readonly indices: Buffer
  private readonly offsets: Buffer
  private readonly members: Buffer
  private readonly targets: Buffer
  private readonly strengths: Buffer
  private readonly params: Buffer
  private readonly reduce: Kernel
  private readonly pull: Kernel

  private constructor (
    private readonly device: Device, data: GraphData, private readonly mapping: Map<number, number>, membership: Uint32Array
  ) {
    this.count = membership.length
    const groups = mapping.size
    const offsets = new Uint32Array(groups + 1)
    for (const id of membership) if (id < groups) offsets[id + 1]!++
    for (let i = 0; i < groups; i++) offsets[i + 1]! += offsets[i]!
    const ids = new Uint32Array(offsets[groups]!)
    const cursors = offsets.slice()
    for (const [i, group] of membership.entries()) {
      if (group < groups) ids[cursors[group]!++] = i
    }

    const targets = new Float32Array(groups * 4)
    for (const [id, i] of mapping) {
      const x = data.clusterPositions?.[id * 2]
      const y = data.clusterPositions?.[id * 2 + 1]
      if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) targets.set([x, y, 1, 0], 4 * i)
    }
    try {
      const { own } = this.scope
      this.aggregates = own(device.createBuffer({ byteLength: groups * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
      this.indices = own(upload(device, ids))
      this.offsets = own(upload(device, offsets))
      this.members = own(upload(device, membership))
      this.targets = own(upload(device, targets))
      this.strengths = own(upload(device, data.clusterStrength ?? new Float32Array(this.count).fill(1)))
      this.params = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
      this.reduce = kernel(device, this.scope, centroids, 'main', [['positions', read], ['ids', read], ['offsets', read], ['aggregates', write]])
      this.pull = kernel(device, this.scope, arithmetic + clusterSource, 'main',
        [['positions', read], ['aggregates', read], ['membership', read], ['targets', read], ['strengths', read], ['forces', write], ['params', uniform]])
    } catch (error) {
      this.scope.destroy()
      throw error
    }
  }

  public static create (device: Device, data: GraphData): Clusters | undefined {
    if (!data.pointClusters) return undefined
    const mapping = new Map<number, number>()
    const membership = Uint32Array.from(data.pointClusters, id => {
      if (id === undefined || !Number.isSafeInteger(id) || id < 0) return 0xffffffff
      if (!mapping.has(id)) mapping.set(id, mapping.size)
      return mapping.get(id)!
    })
    if (!mapping.size) return undefined
    return new Clusters(device, data, mapping, membership)
  }

  public reducePositions (pass: ComputePass, positions: Buffer): void {
    const groups = this.mapping.size
    const bindings = { positions, ids: this.indices, offsets: this.offsets, aggregates: this.aggregates }
    this.reduce.dispatch(pass, { x: Math.min(groups, 65535), y: Math.ceil(groups / 65535), bindings })
  }

  public decodeCentroids (sums: Float32Array): number[] {
    let groupCount = 0
    for (const id of this.mapping.keys()) groupCount = Math.max(groupCount, id + 1)
    if (groupCount * 8 > this.device.limits.maxStorageBufferBindingSize) {
      throw new RangeError('Cluster index exceeds this device’s supported position array size.')
    }
    const result = new Array<number>(2 * groupCount).fill(NaN)
    for (const [id, i] of this.mapping) {
      const n = sums[i * 4 + 2]!
      result[id * 2] = sums[i * 4]! / n
      result[id * 2 + 1] = sums[i * 4 + 1]! / n
    }
    return result
  }

  public encode (pass: ComputePass, positions: Buffer, forces: Buffer, alpha: number, strength: number): void {
    this.reducePositions(pass, positions)
    this.params.write(new Float32Array([this.count, alpha, strength, 0]))
    const bindings = {
      positions,
      aggregates: this.aggregates,
      membership: this.members,
      targets: this.targets,
      strengths: this.strengths,
      forces,
      params: this.params,
    }
    this.pull.dispatch(pass, { x: Math.ceil(this.count / 64), bindings })
  }

  public destroy (): void {
    this.scope.destroy()
  }
}
