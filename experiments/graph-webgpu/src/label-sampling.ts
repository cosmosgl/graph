import { Buffer, type BindingDeclaration, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import type { GraphView } from './renderer'
import type { PointPositionBuffer } from './simulation'
import source from './label-sampling.wgsl?raw'

type Entry = [number, number, number]
type Cache = { pending: boolean; key?: string; entries: Map<number, Entry> }

/** Return completed screen-grid samples immediately and coalesce reads while the GPU is busy. */
export class LabelSampling {
  private readonly select: Kernel
  private readonly gather: Kernel
  private edges?: Buffer
  private order?: Buffer
  private revision = 0
  private readonly points: Cache = { pending: false, entries: new Map() }
  private readonly links: Cache = { pending: false, entries: new Map() }

  public constructor (private readonly device: Device) {
    const bindings: BindingDeclaration[] = [
      { name: 'points', type: 'read-only-storage', location: 0, group: 0 },
      { name: 'edges', type: 'read-only-storage', location: 1, group: 0 },
      { name: 'winners', type: 'storage', location: 2, group: 0 },
      { name: 'result', type: 'storage', location: 3, group: 0 },
      { name: 'view', type: 'uniform', location: 4, group: 0 },
      { name: 'drawOrder', type: 'read-only-storage', location: 5, group: 0 },
    ]
    this.select = new Kernel(device, { source, entryPoint: 'selectCells', shaderLayout: { bindings: bindings.filter(binding => binding.name !== 'result') } })
    this.gather = new Kernel(device, { source, entryPoint: 'gatherCells', shaderLayout: { bindings } })
  }

  public invalidate (): void {
    this.revision++
    this.edges?.destroy()
    this.edges = undefined
    this.order?.destroy()
    this.order = undefined
    for (const cache of [this.points, this.links]) {
      cache.entries = new Map()
      cache.key = undefined
    }
  }

  public sample (source: PointPositionBuffer, view: GraphView, spacing: number, edges?: Float32Array, bend = 0, order?: Uint32Array): ReadonlyMap<number, Entry> {
    const cache = edges ? this.links : this.points
    const count = edges ? edges.length / 2 : source.count
    const cols = Math.ceil(view.width / spacing)
    const rows = Math.ceil(view.height / spacing)
    if (!count || !(cols > 0 && rows > 0) || cols * rows * 16 > this.device.limits.maxStorageBufferBindingSize) return new Map()
    const key = [source.version, this.revision, view.x, view.y, view.scale, view.width, view.height, cols, rows, bend].join('/')
    if (!cache.pending && cache.key !== key) {
      const revision = this.revision
      if (order && !this.order) this.order = this.device.createBuffer({ data: order, usage: Buffer.STORAGE })
      cache.pending = true
      this.read(source, view, cols, rows, edges, bend).then(entries => {
        if (this.revision === revision) { cache.entries = entries; cache.key = key }
      }).catch(error => {
        if (this.revision === revision && !this.device.isLost) console.error(error)
      }).finally(() => { cache.pending = false })
    }
    return cache.entries
  }

  public destroy (): void {
    this.invalidate()
    this.select.destroy()
    this.gather.destroy()
  }

  private async read (positions: PointPositionBuffer, view: GraphView, cols: number, rows: number, links: Float32Array | undefined, bend: number): Promise<Map<number, Entry>> {
    const count = links ? links.length / 2 : positions.count
    const data = new Float32Array([view.x, view.y, view.width, view.height, 0, 0, 0, 0, view.scale, bend, 0, 0])
    new Uint32Array(data.buffer).set([cols, rows, count, Number(!!links)], 4)
    new Uint32Array(data.buffer)[10] = Number(!links && !!this.order)
    const resources: Array<{ destroy(): void }> = []
    if (links && !this.edges) this.edges = this.device.createBuffer({ data: links, usage: Buffer.STORAGE })
    try {
      const winners = this.device.createBuffer({ byteLength: cols * rows * 4, usage: Buffer.STORAGE })
      resources.push(winners)
      const result = this.device.createBuffer({ byteLength: cols * rows * 16, usage: Buffer.STORAGE | Buffer.COPY_SRC })
      resources.push(result)
      const uniform = this.device.createBuffer({ data, usage: Buffer.UNIFORM })
      resources.push(uniform)
      const bindings = { points: positions.buffer, edges: this.edges ?? positions.buffer, winners, view: uniform, drawOrder: this.order ?? positions.buffer }
      const encoder = this.device.createCommandEncoder()
      resources.push(encoder)
      const pass = encoder.beginComputePass({})
      try {
        this.select.dispatch(pass, { bindings, x: Math.ceil(count / 64) })
        this.gather.dispatch(pass, { bindings: { ...bindings, result }, x: Math.ceil(cols * rows / 64) })
      } finally { pass.end() }
      this.device.submit(encoder.finish())
      const bytes = await result.readAsync()
      const ids = new Uint32Array(bytes.buffer, bytes.byteOffset, cols * rows * 4)
      const values = new Float32Array(bytes.buffer, bytes.byteOffset, ids.length)
      const entries = new Map<number, Entry>()
      for (let i = 0; i < ids.length; i += 4) {
        if (ids[i]) entries.set(ids[i]! - 1, [values[i + 1]!, values[i + 2]!, values[i + 3]!])
      }
      return entries
    } finally { for (const resource of resources) resource.destroy() }
  }
}
