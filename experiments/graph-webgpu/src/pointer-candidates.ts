import { Buffer, type Device, type BindingDeclaration } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import type { GraphConfigInterface } from '@/graph/config'
import { PICKING_WINDOW_SIZE } from '@/graph/modules/Points/picking-constants'
import type { GraphView } from './renderer'
import records from './style-records.wgsl?raw'
import { readPointStyle } from './modules/Points/style-table'
import scan from './pointer-candidates.wgsl?raw'

const bindings: BindingDeclaration[] = [
  { name: 'params', group: 0, location: 0, type: 'uniform' },
  { name: 'positions', group: 0, location: 1, type: 'read-only-storage' },
  { name: 'points', group: 0, location: 2, type: 'read-only-storage' },
  { name: 'order', group: 0, location: 3, type: 'read-only-storage' },
  { name: 'links', group: 0, location: 4, type: 'read-only-storage' },
  { name: 'blocks', group: 0, location: 5, type: 'storage' },
  { name: 'draws', group: 0, location: 6, type: 'storage' },
  { name: 'pointIndices', group: 0, location: 7, type: 'storage' },
  { name: 'linkIndices', group: 0, location: 8, type: 'storage' },
]

/** Rebuild the pointer's draw list from live GPU positions for each query. */
export class PointerCandidates {
  public readonly draws: Buffer
  public points!: Buffer
  public links!: Buffer
  private blocks!: Buffer
  private readonly params: Buffer
  private readonly candidates: Kernel
  private readonly prefix: Kernel
  private readonly compact: Kernel

  public constructor (private readonly device: Device) {
    this.params = device.createBuffer({ id: 'cosmos-pick-bounds', byteLength: 112, usage: Buffer.UNIFORM | Buffer.COPY_DST })
    this.draws = device.createBuffer({ id: 'cosmos-pick-draws', byteLength: 32, usage: Buffer.STORAGE | Buffer.INDIRECT })
    const kernel = (entryPoint: string, slots: number[]): Kernel => new Kernel(device, {
      id: `cosmos-pick-${entryPoint}`,
      source: records + scan + readPointStyle('readCurrentPoint', 'points'),
      entryPoint,
      shaderLayout: { bindings: slots.map(i => bindings[i]!) },
    })
    this.candidates = kernel('candidates', [0, 1, 2, 3, 4, 5])
    this.prefix = kernel('prefix', [0, 5, 6])
    this.compact = kernel('compact', [5, 7, 8])
  }

  public select (config: GraphConfigInterface, view: GraphView, projection: NonNullable<GraphView['pointProjection']>,
    region: readonly number[], pixel: readonly number[], pointCount: number, linkCount: number,
    positions: Buffer, points: Buffer, order: Buffer, links: Buffer, pointRecords = 0): void {
    const groups = Math.ceil(Math.max(pointCount, linkCount) / 128)
    this.blocks = this.reserve(this.blocks, groups * 48, 'cosmos-pick-blocks')
    this.points = this.reserve(this.points, pointCount * 4, 'cosmos-pick-points')
    this.links = this.reserve(this.links, linkCount * 4, 'cosmos-pick-links')
    const zoom = view.scale
    const fixed = Math.min(5, Math.max(1, zoom * 0.01))
    const extraWidth = 5 + Math.max(config.hoveredLinkWidthIncrease, 0) + Math.max(config.focusedLinkWidthIncrease, 0)
    const values = new Float32Array(28)
    values.set([...projection.origin, view.width, view.height, ...projection.transform, ...region,
      ...pixel, config.pointSizeScale, config.linkWidthScale * (config.scaleLinksOnZoom ? zoom : fixed),
      Math.max(1, 2 * config.linkArrowsSizeScale), extraWidth / 2 + 1 / view.pixelRatio,
      config.scalePointsOnZoom ? zoom : fixed, Math.max(Math.abs(projection.transform[0]), Math.abs(projection.transform[1])) / zoom])
    new Uint32Array(values.buffer).set([pointCount, linkCount, PICKING_WINDOW_SIZE, groups, pointRecords], 20)
    this.params.write(values)
    const pass = this.device.beginComputePass({})
    try {
      this.candidates.dispatch(pass, { x: groups, bindings: { params: this.params, positions, points, order, links, blocks: this.blocks } })
      this.prefix.dispatch(pass, { x: 1, bindings: { params: this.params, blocks: this.blocks, draws: this.draws } })
      this.compact.dispatch(pass, { x: groups, bindings: { blocks: this.blocks, pointIndices: this.points, linkIndices: this.links } })
    } finally { pass.end() }
  }

  public destroy (): void {
    this.candidates.destroy()
    this.prefix.destroy()
    this.compact.destroy()
    this.params.destroy()
    this.blocks?.destroy()
    this.points?.destroy()
    this.links?.destroy()
    this.draws.destroy()
  }

  private reserve (buffer: Buffer | undefined, bytes: number, id: string): Buffer {
    if (buffer && buffer.byteLength >= bytes) return buffer
    const next = this.device.createBuffer({ id, byteLength: Math.max(bytes, 4), usage: Buffer.STORAGE })
    buffer?.destroy()
    return next
  }
}
