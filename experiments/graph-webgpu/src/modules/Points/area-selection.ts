import { Buffer, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import type { GraphConfigInterface } from '@/graph/config'
import { PointShape, type GraphData } from '@/graph/modules/GraphData'
import type { Store } from '@/graph/modules/Store'
import source from './area-selection.wgsl?raw'

export type Pair = [number, number]
export type Area = { rect: [Pair, Pair] } | { polygon: Pair[] }

export class AreaSelection {
  private readonly kernel: Kernel
  private footprints?: Buffer

  public constructor (private readonly device: Device) {
    this.kernel = new Kernel(device, {
      source,
      shaderLayout: {
        bindings: [
          { name: 'points', group: 0, location: 0, type: 'read-only-storage' },
          { name: 'footprints', group: 0, location: 1, type: 'read-only-storage' },
          { name: 'path', group: 0, location: 2, type: 'read-only-storage' },
          { name: 'mask', group: 0, location: 3, type: 'storage' },
          { name: 'view', group: 0, location: 4, type: 'uniform' },
        ],
      },
    })
  }

  public invalidateFootprints (): void {
    this.footprints?.destroy()
    this.footprints = undefined
  }

  public async select (points: Buffer, data: GraphData, config: GraphConfigInterface, store: Store, area: Area): Promise<number[]> {
    const count = data.pointsNumber ?? 0
    if (!count) return []
    if (!this.footprints) {
      // Target diameters are nonnegative. Store untextured squares with a minus
      // sign so resolving the shape needs no second word per simulated point.
      const footprints = new Float32Array(count)
      for (let i = 0; i < count; i++) {
        const diameter = data.getResolvedPointFootprint(i)
        const square = data.pointShapes?.[i] === PointShape.Square && !data.pointDrawsImage(i)
        footprints[i] = square ? -diameter : diameter
      }
      this.footprints = this.device.createBuffer({ data: footprints, usage: Buffer.STORAGE })
    }
    // Match WebGL's lower-left projection and evaluate the bounds at the
    // precision of the path the shader actually reads.
    const { screenSize: [width, height], transform, worldOrigin } = store
    const vertices = 'polygon' in area ? area.polygon : area.rect
    const pathData = 'polygon' in area ? new Float32Array(vertices.length * 2) : new Float32Array(2)
    let left = Infinity
    let bottom = Infinity
    let right = -Infinity
    let top = -Infinity
    for (const [i, [screenX, screenY]] of vertices.entries()) {
      const x = Math.fround(screenX)
      const y = Math.fround(height - screenY)
      if ('polygon' in area) {
        pathData[i * 2] = x
        pathData[i * 2 + 1] = y
      }
      left = Math.min(left, x)
      right = Math.max(right, x)
      bottom = Math.min(bottom, y)
      top = Math.max(top, y)
    }
    const zoom = transform[0]
    const params = new Float32Array(20)
    params.set([...worldOrigin, width, height, zoom, transform[4], transform[6], transform[7], left, bottom, right, top])
    params.set([config.pointSizeScale, config.pixelRatio, config.scalePointsOnZoom ? zoom : Math.min(5, Math.max(1, zoom * 0.01))], 12)
    const integers = new Uint32Array(params.buffer)
    integers[15] = 'polygon' in area ? vertices.length : 0
    integers[16] = Number(config.pointSelectionMode === 'center')

    // Each request owns its output and camera/geometry snapshot until its copy completes.
    const resources: Array<{ destroy(): void }> = []
    try {
      const path = this.device.createBuffer({ data: pathData, usage: Buffer.STORAGE })
      resources.push(path)
      const uniform = this.device.createBuffer({ data: params, usage: Buffer.UNIFORM })
      resources.push(uniform)
      const mask = this.device.createBuffer({ byteLength: count * 4, usage: Buffer.STORAGE | Buffer.COPY_SRC })
      resources.push(mask)
      const encoder = this.device.createCommandEncoder()
      resources.push(encoder)
      const pass = encoder.beginComputePass({})
      try {
        this.kernel.dispatch(pass, { x: Math.ceil(count / 64), bindings: { points, footprints: this.footprints, path, mask, view: uniform } })
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
    this.invalidateFootprints()
    this.kernel.destroy()
  }
}
