import { Buffer, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import type { GraphConfigInterface } from '@/graph/config'
import type { GraphData } from '@/graph/modules/GraphData'
import type { GraphView } from '../../renderer'
import source from './area-selection.wgsl?raw'

export type Pair = [number, number]
export type Area = { rect: [Pair, Pair] } | { polygon: Pair[] }

export class AreaSelection {
  private readonly kernel: Kernel
  private sizes?: Buffer

  public constructor (private readonly device: Device) {
    this.kernel = new Kernel(device, {
      source,
      shaderLayout: {
        bindings: [
          { name: 'points', group: 0, location: 0, type: 'read-only-storage' },
          { name: 'sizes', group: 0, location: 1, type: 'read-only-storage' },
          { name: 'path', group: 0, location: 2, type: 'read-only-storage' },
          { name: 'mask', group: 0, location: 3, type: 'storage' },
          { name: 'view', group: 0, location: 4, type: 'uniform' },
        ],
      },
    })
  }

  public invalidateSizes (): void {
    this.sizes?.destroy()
    this.sizes = undefined
  }

  public async select (points: Buffer, data: GraphData, config: GraphConfigInterface, view: GraphView, area: Area, maxSize: number): Promise<number[]> {
    const count = data.pointsNumber ?? 0
    if (!count || ('polygon' in area && area.polygon.length < 3)) return []
    if (!this.sizes) {
      const sizes = Float32Array.from({ length: count }, (_, i) => data.getResolvedPointFootprint(i))
      this.sizes = this.device.createBuffer({ data: sizes, usage: Buffer.STORAGE })
    }
    const params = new Float32Array(12)
    params.set([view.x, view.y, view.scale, config.pointSizeScale])
    if ('rect' in area) {
      const [[x0, y0], [x1, y1]] = area.rect
      params.set([Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)], 4)
    }
    params.set([config.scalePointsOnZoom ? view.scale : Math.min(5, Math.max(1, view.scale * 0.01)), view.pixelRatio, maxSize], 8)
    const vertices = 'polygon' in area ? area.polygon : []
    new Uint32Array(params.buffer)[11] = vertices.length

    // Each request owns its output and camera/geometry snapshot until its copy completes.
    const resources: Array<{ destroy(): void }> = []
    try {
      const path = this.device.createBuffer({ data: new Float32Array(vertices.length ? vertices.flat() : [0, 0]), usage: Buffer.STORAGE })
      resources.push(path)
      const uniform = this.device.createBuffer({ data: params, usage: Buffer.UNIFORM })
      resources.push(uniform)
      const mask = this.device.createBuffer({ byteLength: count * 4, usage: Buffer.STORAGE | Buffer.COPY_SRC })
      resources.push(mask)
      const encoder = this.device.createCommandEncoder()
      resources.push(encoder)
      const pass = encoder.beginComputePass({})
      try {
        this.kernel.dispatch(pass, { x: Math.ceil(count / 64), bindings: { points, sizes: this.sizes, path, mask, view: uniform } })
      } finally { pass.end() }
      this.device.submit(encoder.finish())
      const bytes = await mask.readAsync()
      const flags = new Uint32Array(bytes.buffer, bytes.byteOffset, count)
      const ids: number[] = []
      for (let i = 0; i < count; i++) if (flags[i]) ids.push(i)
      return ids
    } finally {
      for (const resource of resources) resource.destroy()
    }
  }

  public destroy (): void {
    this.invalidateSizes()
    this.kernel.destroy()
  }
}
