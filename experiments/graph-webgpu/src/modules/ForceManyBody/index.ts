import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import { isRepulsionSampleCount, type GraphConfigInterface } from '@/graph/config'
import { ALL_PAIRS_MAX_POINTS, MIN_AUTO_SLOTS, getAffordableSlotCount, usesPreciseFarField } from '@/graph/modules/ForceManyBody/settings'
import type { Store } from '@/graph/modules/Store'
import { getFinestGridSize, getNearFieldSlotCount } from '@/graph/modules/Shared/cell-slots'
import { resourceScope } from '../Shared/resource-scope'
import { kernel, upload } from '../Shared/compute'
import direct from './force-direct.wgsl?raw'
import { createNearField } from './near-field'
import { createOccupancyMeasurement } from './occupancy'
import { createRepulsionGrid } from './repulsion-grid'

const read = 'read-only-storage'; const write = 'storage'; const uniform = 'uniform'
type Scope = ReturnType<typeof resourceScope>

export function createRepulsionKernel (device: Device, scope: Scope): Kernel {
  return kernel(device, scope, direct, 'direct', [['positions', read], ['samples', read], ['params', uniform], ['forces', write]])
}

type ReduceBounds = (pass: ComputePass, positions: Buffer, kind: 'bounds') => Buffer
interface ManyBody {
  readonly nearLimit: number;
  updateSamples(): void;
  prepare(config: GraphConfigInterface, measureOccupancy: boolean): void;
  collectOccupancy(): void;
  restartOccupancyMeasurement(): void;
  encode(pass: ComputePass, positions: Buffer, forces: Buffer, params: Buffer, config: GraphConfigInterface,
    reduce: ReduceBounds, measureOccupancy: boolean): boolean;
  destroy(): void;
}

export function createManyBody (device: Device, count: number, store: Store, program: Kernel): ManyBody {
  const groups = Math.ceil(count / 64)
  const width = getFinestGridSize(count)
  let samples: Buffer | undefined
  const affordable = getAffordableSlotCount(count)
  let grid: ReturnType<typeof createRepulsionGrid> | undefined
  let near: ReturnType<typeof createNearField> | undefined
  let occupancy: ReturnType<typeof createOccupancyMeasurement> | undefined
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
    prepare (config, measureOccupancy): void {
      if (count <= ALL_PAIRS_MAX_POINTS || !config.simulationRepulsion) return
      grid ??= createRepulsionGrid(device, count)
      near ??= createNearField(device, count)
      if (measureOccupancy && !isRepulsionSampleCount(config.simulationRepulsionSamples) && affordable > MIN_AUTO_SLOTS) {
        occupancy ??= createOccupancyMeasurement(device, width)
      }
    },
    collectOccupancy (): void { occupancy?.collect() },
    restartOccupancyMeasurement (): void { occupancy?.reset() },
    encode (pass, positions, forces, params, config, reduce, measureOccupancy): boolean {
      if (!samples || count < 2) return false
      const strength = config.simulationRepulsion
      if (count <= ALL_PAIRS_MAX_POINTS) {
        if (!strength) return false
        program.dispatch(pass, { x: groups, bindings: { positions, samples, params, forces } })
        return true
      }

      // WebGL draws the grid even at zero strength. Consume its three per-tick
      // samples in order so springs and collision see the same seeded sequence.
      const offsetX = store.getRandomFloat(0, 1)
      const offsetY = store.getRandomFloat(0, 1)
      const hashSeed = store.getRandomFloat(0, 1)
      if (!strength || !grid || !near) return false
      grid.encode(pass, positions, reduce(pass, positions, 'bounds'), store.alpha, strength, offsetX, offsetY,
        usesPreciseFarField(config.simulationRepulsionQuality, count), forces)
      const configured = config.simulationRepulsionSamples
      const slotCount = isRepulsionSampleCount(configured)
        ? configured
        : Math.min(occupancy?.wanted ?? getNearFieldSlotCount(count), affordable)
      if (measureOccupancy && !isRepulsionSampleCount(configured)) occupancy?.encode(pass, grid.cells)
      near.encode(pass, positions, grid, samples, forces, store.alpha, strength, store.kickSpan / width, hashSeed, slotCount)
      return true
    },
    destroy (): void {
      samples?.destroy()
      near?.destroy()
      grid?.destroy()
      occupancy?.destroy()
      samples = near = grid = occupancy = undefined
    },
  }
}
