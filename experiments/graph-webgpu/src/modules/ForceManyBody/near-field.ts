import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { getFinestGridSize } from '@/graph/modules/Shared/cell-slots'
import { kernel, upload, workgroupGrid } from '../Shared/compute'
import { resourceScope } from '../Shared/resource-scope'
import gridCell from './grid-cell.wgsl?raw'
import near from './near-field.wgsl?raw'
import type { RepulsionGrid } from './repulsion-grid'

type Grid = Pick<RepulsionGrid, 'cells' | 'box'>
interface NearField {
  readonly sampleCount: number;
  encode(pass: ComputePass, positions: Buffer, grid: Grid, slots: Buffer, samples: Buffer, forces: Buffer,
    alpha: number, strength: number, maxStep: number, slotCount: number): void;
  destroy(): void;
}

export function createNearField (device: Device, count: number): NearField {
  const scope = resourceScope()
  const pointGroups = workgroupGrid(Math.ceil(count / 64), device.limits.maxComputeWorkgroupsPerDimension)
  const width = getFinestGridSize(count)
  const source = [gridCell, near].join('\n')
  const read = 'read-only-storage'; const write = 'storage'
  try {
    const add = kernel(device, scope, source, 'addNearRepulsion', [
      ['params', 'uniform'], ['slots', read, 3], ['positions', read, 4], ['samples', read, 5],
      ['cells', read, 6], ['box', read, 7], ['forces', write, 8],
    ])
    const words = new Uint32Array([count, width, 0, 0, 0, 0, 0, 0])
    const floats = new Float32Array(words.buffer)
    const params = scope.own(upload(device, words, Buffer.UNIFORM))
    return {
      get sampleCount (): number { return words[2]! },
      encode (pass, positions, grid, slots, samples, forces, alpha, strength, maxStep, slotCount): void {
        words[2] = slotCount
        floats.set([alpha, strength, maxStep], 4)
        params.write(words)
        add.dispatch(pass, {
          ...pointGroups,
          bindings: { params, slots, positions, samples, cells: grid.cells, box: grid.box, forces },
        })
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
