import type { Buffer, ComputePass, Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import { isRepulsionSampleCount, type GraphConfigInterface } from '@/graph/config'
import { ALL_PAIRS_MAX_POINTS, MIN_AUTO_SLOTS, getAffordableSlotCount, usesPreciseFarField } from '@/graph/modules/ForceManyBody/settings'
import type { Store } from '@/graph/modules/Store'
import { getFinestGridSize, getNearFieldSlotCount } from '@/graph/modules/Shared/cell-slots'
import type { resourceScope } from '../Shared/resource-scope'
import { kernel, upload } from '../Shared/compute'
import direct from './force-direct.wgsl?raw'
import { createNearField } from './near-field'
import { createOccupancyMeasurement } from './occupancy'
import { createRepulsionGrid, type RepulsionGrid } from './repulsion-grid'

const read = 'read-only-storage'; const write = 'storage'; const uniform = 'uniform'
type Scope = ReturnType<typeof resourceScope>

export function createRepulsionKernel (device: Device, scope: Scope): Kernel {
  return kernel(device, scope, direct, 'direct', [['positions', read], ['samples', read], ['params', uniform], ['forces', write]])
}

type ReduceBounds = (pass: ComputePass, positions: Buffer, kind: 'bounds') => Buffer

export class ForceManyBody {
  private readonly groups: number
  private readonly width: number
  private readonly affordableSlots: number
  private samples?: Buffer
  private grid?: RepulsionGrid
  private near?: ReturnType<typeof createNearField>
  private occupancy?: ReturnType<typeof createOccupancyMeasurement>

  public constructor (
    private readonly device: Device,
    private readonly count: number,
    private readonly store: Store,
    private readonly program: Kernel
  ) {
    this.groups = Math.ceil(count / 64)
    this.width = getFinestGridSize(count)
    this.affordableSlots = getAffordableSlotCount(count)
  }

  /** Counts used by the performance story. Reading them starts no GPU work. */
  public get sampling (): { count?: number; wanted?: number } {
    return { count: this.near?.sampleCount || undefined, wanted: this.occupancy?.wanted }
  }

  public get nearLimit (): number {
    return this.store.kickSpan / this.width
  }

  public updateSamples (): void {
    // The reference consumes two samples for every slot of its square position texture
    // before assigning the spring rest lengths. Keep seeded layouts reproducible,
    // including for non-square point counts and for a later re-enable of repulsion.
    const textureSlots = Math.ceil(Math.sqrt(this.count)) ** 2
    const jitter = new Float32Array(this.count * 2)
    const sample = this.store.getRandomFloatGenerator(-1, 1)
    for (let i = 0; i < textureSlots; i++) {
      const x = sample() * 0.00001
      const y = sample() * 0.00001
      if (i < this.count) {
        jitter[2 * i] = x
        jitter[2 * i + 1] = y
      }
    }
    if (this.samples) this.samples.write(jitter)
    else this.samples = upload(this.device, jitter)
  }

  public prepare (config: GraphConfigInterface, measureOccupancy: boolean): void {
    if (this.count <= ALL_PAIRS_MAX_POINTS || !config.simulationRepulsion) return
    this.grid ??= createRepulsionGrid(this.device, this.count)
    this.near ??= createNearField(this.device, this.count)
    if (measureOccupancy && !isRepulsionSampleCount(config.simulationRepulsionSamples) && this.affordableSlots > MIN_AUTO_SLOTS) {
      this.occupancy ??= createOccupancyMeasurement(this.device, this.width)
    }
  }

  public collectOccupancy (): void {
    this.occupancy?.collect()
  }

  public restartOccupancyMeasurement (): void {
    this.occupancy?.reset()
  }

  public encode (
    pass: ComputePass, positions: Buffer, forces: Buffer, params: Buffer, config: GraphConfigInterface,
    reduce: ReduceBounds, measureOccupancy: boolean
  ): boolean {
    const { count, samples, store } = this
    if (!samples || count < 2) return false
    const strength = config.simulationRepulsion
    if (count <= ALL_PAIRS_MAX_POINTS) {
      if (!strength) return false
      this.program.dispatch(pass, { x: this.groups, bindings: { positions, samples, params, forces } })
      return true
    }

    // WebGL draws the grid even at zero strength. Consume its three per-tick
    // samples in order so springs and collision see the same seeded sequence.
    const offsetX = store.getRandomFloat(0, 1)
    const offsetY = store.getRandomFloat(0, 1)
    const hashSeed = store.getRandomFloat(0, 1)
    const { grid, near, occupancy } = this
    if (!strength || !grid || !near) return false
    const configured = config.simulationRepulsionSamples
    const slotCount = isRepulsionSampleCount(configured)
      ? configured
      : Math.min(occupancy?.wanted ?? getNearFieldSlotCount(count), this.affordableSlots)
    const slots = grid.encode(pass, positions, reduce(pass, positions, 'bounds'), store.alpha, strength, offsetX, offsetY,
      usesPreciseFarField(config.simulationRepulsionQuality, count), forces, hashSeed, slotCount)
    if (measureOccupancy && !isRepulsionSampleCount(configured)) occupancy?.encode(pass, grid.cells)
    near.encode(pass, positions, grid, slots, samples, forces, store.alpha, strength, this.nearLimit, slotCount)
    return true
  }

  public destroy (): void {
    this.samples?.destroy()
    this.near?.destroy()
    this.grid?.destroy()
    this.occupancy?.destroy()
    this.samples = undefined
    this.near = undefined
    this.grid = undefined
    this.occupancy = undefined
  }
}
