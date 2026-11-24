import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { MIN_AUTO_SLOTS, OCCUPANCY_INTERVAL, getWantedSlotCount } from '@/graph/modules/ForceManyBody/settings'
import { kernel } from '../Shared/compute'
import { resourceScope } from '../Shared/resource-scope'
import source from './occupancy.wgsl?raw'

interface OccupancyMeasurement {
  readonly wanted: number | undefined;
  encode(pass: ComputePass, cells: Buffer): void;
  collect(): Promise<void> | undefined;
  reset(): void;
  destroy(): void;
}

/** Measure the automatic near-field budget asynchronously on the graph's own frames. */
export function createOccupancyMeasurement (device: Device, width: number): OccupancyMeasurement {
  const scope = resourceScope()
  try {
    const constants = `const CELL_COUNT = ${width * width}u; const MIN_SLOTS = ${MIN_AUTO_SLOTS}u;\n`
    const count = kernel(device, scope, constants + source, 'countOccupancy', [['cells', 'read-only-storage'], ['totals', 'storage']])
    const totals = scope.own(device.createBuffer({ byteLength: 16, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    let wanted: number | undefined
    let proposed: number | undefined
    let ticksUntilMeasure = 0
    let encoded = false
    let reading = false
    let generation = 0
    const reset = (): void => {
      generation++
      wanted = proposed = undefined
      ticksUntilMeasure = 0
      encoded = false
    }
    return {
      get wanted (): number | undefined { return wanted },
      encode (pass, cells): void {
        if (ticksUntilMeasure > 0) { ticksUntilMeasure--; return }
        if (reading) return
        count.dispatch(pass, { x: 1, bindings: { cells, totals } })
        ticksUntilMeasure = OCCUPANCY_INTERVAL - 1
        encoded = true
      },
      collect (): Promise<void> | undefined {
        if (!encoded) return undefined
        encoded = false
        reading = true
        const issued = generation
        // A separate copy after the simulation submission puts 16 bytes in
        // staging. Neither the frame nor the next step waits for the CPU map.
        return totals.readAsync().then(bytes => {
          if (issued !== generation) return
          const values = new Uint32Array(bytes.buffer, bytes.byteOffset, 4)
          if (!values[0]) return
          const next = getWantedSlotCount(values[0], Array.from(values.subarray(1)))
          if (wanted === undefined || proposed === next) {
            wanted = next
            proposed = undefined
          } else {
            proposed = next === wanted ? undefined : next
          }
        }, () => {
          // A lost device or failed map provides no occupancy sample.
        }).finally(() => { reading = false })
      },
      reset,
      destroy (): void { reset(); scope.destroy() },
    }
  } catch (error) { scope.destroy(); throw error }
}
