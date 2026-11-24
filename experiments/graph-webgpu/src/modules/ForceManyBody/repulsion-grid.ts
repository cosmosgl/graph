import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { COARSEST_GRID_SIZE, MIN_FINEST_CELL_SIZE } from '@/graph/modules/ForceManyBody/settings'
import { getFinestGridSize } from '@/graph/modules/Shared/cell-slots'
import { kernel, upload, type Decl } from '../Shared/compute'
import { resourceScope } from '../Shared/resource-scope'
import gridCell from './grid-cell.wgsl?raw'
import pyramid from './repulsion-grid.wgsl?raw'

const gridSource = `const coarsestWidth = ${COARSEST_GRID_SIZE}u;
const minFinestCellSize = ${MIN_FINEST_CELL_SIZE};
${gridCell}
${pyramid}`

export interface RepulsionGrid {
  readonly box: Buffer;
  readonly cells: Buffer;
  readonly heads: Buffer;
  readonly next: Buffer;
  encode(pass: ComputePass, positions: Buffer, bounds: Buffer, alpha: number, strength: number,
    offsetX: number, offsetY: number, precise: boolean, forces: Buffer): void;
  destroy(): void;
}

/** Finest cells start at index zero. All levels use row-major addressing. */
export function createRepulsionGrid (device: Device, count: number): RepulsionGrid {
  const scope = resourceScope()
  try {
    const width = getFinestGridSize(count)
    const leafCount = width * width
    const levels: Array<{ count: number; params: Buffer }> = []
    let cellCount = leafCount
    let childOffset = 0
    for (let edge = width / 2; edge >= COARSEST_GRID_SIZE; edge /= 2) {
      const params = scope.own(upload(device, new Uint32Array([edge, cellCount, childOffset, 0]), Buffer.UNIFORM))
      levels.push({ count: edge * edge, params })
      childOffset = cellCount
      cellCount += edge * edge
    }
    const storage = (id: string, byteLength: number): Buffer => scope.own(device.createBuffer({ id, byteLength, usage: Buffer.STORAGE }))
    const box = storage('repulsion-grid-bounds', 16)
    const heads = storage('repulsion-cell-heads', leafCount * 4)
    const next = storage('repulsion-next-point', count * 4)
    const sums = storage('repulsion-leaf-sums', leafCount * 12)
    const cells = storage('repulsion-cell-centroids', cellCount * 16)
    const words = new Uint32Array([count, width, 0, Math.min(0x400000, Math.floor(0xffffffff / count)), 0, 0, 0, 0])
    const values = new Float32Array(words.buffer)
    const settings = scope.own(upload(device, words, Buffer.UNIFORM))
    const build = (name: string, bindings: Decl[]): ReturnType<typeof kernel> => kernel(device, scope, gridSource, name, bindings)
    const fit = build('fitBox', [['bounds', 'read-only-storage', 1], ['box', 'storage', 2], ['settings', 'uniform', 3]])
    const clear = build('clearLeaves', [['heads', 'storage', 4], ['sums', 'storage', 6]])
    const bin = build('binPoints', [
      ['positions', 'read-only-storage', 0], ['box', 'storage', 2], ['settings', 'uniform', 3],
      ['heads', 'storage', 4], ['next', 'storage', 5], ['sums', 'storage', 6],
    ])
    const leaf = build('leafSums', [
      ['positions', 'read-only-storage', 0], ['box', 'storage', 2], ['settings', 'uniform', 3],
      ['heads', 'storage', 4], ['sums', 'storage', 6], ['cells', 'storage', 7],
    ])
    const merge = build('mergeChildren', [['cells', 'storage', 7], ['level', 'uniform', 8]])
    const normalize = build('normalizeCells', [['cells', 'storage', 7]])
    const force = build('farForce', [
      ['positions', 'read-only-storage', 0], ['box', 'storage', 2], ['settings', 'uniform', 3], ['cells', 'storage', 7], ['forces', 'storage', 9],
    ])
    return {
      box,
      heads,
      next,
      cells,
      encode (pass, positions, bounds, alpha, strength, offsetX, offsetY, precise, forces): void {
        words[2] = Number(precise)
        values.set([alpha, strength, offsetX, offsetY], 4)
        settings.write(words)
        fit.dispatch(pass, { x: 1, bindings: { bounds, box, settings } })
        clear.dispatch(pass, { x: Math.ceil(leafCount / 64), bindings: { heads, sums } })
        bin.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, box, settings, heads, next, sums } })
        leaf.dispatch(pass, { x: Math.ceil(leafCount / 64), bindings: { positions, box, settings, heads, sums, cells } })
        for (const level of levels) merge.dispatch(pass, { x: Math.ceil(level.count / 64), bindings: { cells, level: level.params } })
        normalize.dispatch(pass, { x: Math.ceil(cellCount / 64), bindings: { cells } })
        force.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, box, settings, cells, forces } })
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
