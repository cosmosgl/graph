import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { MAX_REPULSION_SAMPLES } from '@/graph/config'
import { getFinestGridSize } from '@/graph/modules/Shared/cell-slots'
import { kernel, upload } from '../Shared/compute'
import { resourceScope } from '../Shared/resource-scope'
import roundedProduct from '../Shared/rounded-product.wgsl?raw'
import cellSlots from '../Shared/select-cell-slots.wgsl?raw'
import gridCell from './grid-cell.wgsl?raw'
import near from './near-field.wgsl?raw'
import type { RepulsionGrid } from './repulsion-grid'

type Grid = Pick<RepulsionGrid, 'heads' | 'next' | 'cells' | 'box'>
interface NearField {
  encode(pass: ComputePass, positions: Buffer, grid: Grid, samples: Buffer, forces: Buffer,
    alpha: number, strength: number, maxStep: number, seed: number, slotCount: number): void;
  destroy(): void;
}

export function createNearField (device: Device, count: number): NearField {
  const scope = resourceScope()
  const width = getFinestGridSize(count)
  const source = [`const maxCellSlots = ${MAX_REPULSION_SAMPLES}u;`, roundedProduct, gridCell, cellSlots, near].join('\n')
  const read = 'read-only-storage'; const write = 'storage'
  let slots: Buffer | undefined
  try {
    const select = kernel(device, scope, source, 'selectNearSlots', [
      ['params', 'uniform'], ['heads', read], ['next', read], ['slots', write],
    ])
    const add = kernel(device, scope, source, 'addNearRepulsion', [
      ['params', 'uniform'], ['slots', write, 3], ['positions', read, 4], ['samples', read, 5],
      ['cells', read, 6], ['box', read, 7], ['forces', write, 8],
    ])
    const words = new Uint32Array([count, width, 0, 0, 0, 0, 0, 0])
    const floats = new Float32Array(words.buffer)
    const params = scope.own(upload(device, words, Buffer.UNIFORM))
    return {
      encode (pass, positions, grid, samples, forces, alpha, strength, maxStep, seed, slotCount): void {
        const bytes = width * width * slotCount * 4
        if (!slots || slots.byteLength < bytes) {
          const replacement = device.createBuffer({ byteLength: bytes, usage: Buffer.STORAGE })
          slots?.destroy()
          slots = replacement
        }
        words[2] = slotCount
        floats.set([seed, alpha, strength, maxStep], 3)
        params.write(words)
        select.dispatch(pass, {
          x: Math.ceil(width * width / 64),
          bindings: { params, heads: grid.heads, next: grid.next, slots },
        })
        add.dispatch(pass, {
          x: Math.ceil(count / 64),
          bindings: { params, slots, positions, samples, cells: grid.cells, box: grid.box, forces },
        })
      },
      destroy (): void { slots?.destroy(); scope.destroy() },
    }
  } catch (error) { scope.destroy(); throw error }
}
