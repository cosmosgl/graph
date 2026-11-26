import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { MAX_REPULSION_SAMPLES } from '@/graph/config'
import { COARSEST_GRID_SIZE, MIN_FINEST_CELL_SIZE } from '@/graph/modules/ForceManyBody/settings'
import { getFinestGridSize } from '@/graph/modules/Shared/cell-slots'
import { kernel, upload, workgroupGrid, type Decl } from '../Shared/compute'
import { resourceScope } from '../Shared/resource-scope'
import roundedProduct from '../Shared/rounded-product.wgsl?raw'
import cellSlots from '../Shared/select-cell-slots.wgsl?raw'
import gridCell from './grid-cell.wgsl?raw'
import pyramid from './repulsion-grid.wgsl?raw'

const gridSource = `const coarsestWidth = ${COARSEST_GRID_SIZE}u;
const minFinestCellSize = ${MIN_FINEST_CELL_SIZE};
const maxCellSlots = ${MAX_REPULSION_SAMPLES}u;
${roundedProduct}
${cellSlots}
${gridCell}
${pyramid}`

export interface RepulsionGrid {
  readonly box: Buffer;
  readonly cells: Buffer;
  encode(pass: ComputePass, positions: Buffer, bounds: Buffer, alpha: number, strength: number,
    offsetX: number, offsetY: number, precise: boolean, forces: Buffer, seed: number, slotCount: number): Buffer;
  destroy(): void;
}

/** Finest cells start at index zero. All levels use row-major addressing. */
export function createRepulsionGrid (device: Device, count: number): RepulsionGrid {
  const scope = resourceScope()
  try {
    const pointGroups = workgroupGrid(Math.ceil(count / 64), device.limits.maxComputeWorkgroupsPerDimension)
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
    // A zero-width record reuses the level pipeline to normalize the finished sums.
    levels.push({ count: cellCount, params: scope.own(upload(device, new Uint32Array(4), Buffer.UNIFORM)) })
    const storage = (id: string, byteLength: number): Buffer => scope.own(device.createBuffer({ id, byteLength, usage: Buffer.STORAGE }))
    const box = storage('repulsion-grid-bounds', 16)
    const heads = storage('repulsion-cell-heads', leafCount * 4)
    const next = storage('repulsion-next-point', count * 4)
    const sums = storage('repulsion-leaf-sums', leafCount * 12)
    const cells = storage('repulsion-cell-centroids', cellCount * 16)
    const slotGroups = Math.min(count, leafCount)
    let slots: Buffer | undefined
    const words = new Uint32Array(12)
    words[0] = count
    words[1] = width
    words[3] = Math.min(0x400000, Math.floor(0xffffffff / count))
    const values = new Float32Array(words.buffer)
    const settings = scope.own(upload(device, words, Buffer.UNIFORM))
    const build = (name: string, bindings: Decl[]): ReturnType<typeof kernel> => kernel(device, scope, gridSource, name, bindings)
    const fit = build('fitBox', [['bounds', 'read-only-storage', 1], ['box', 'storage', 2], ['settings', 'uniform', 3]])
    const bin = build('binPoints', [
      ['positions', 'read-only-storage', 0], ['box', 'storage', 2], ['settings', 'uniform', 3],
      ['heads', 'storage', 4], ['next', 'storage', 5], ['sums', 'storage', 6],
    ])
    const leaf = build('leafSums', [
      ['positions', 'read-only-storage', 0], ['box', 'storage', 2], ['settings', 'uniform', 3],
      ['heads', 'storage', 4], ['next', 'storage', 5], ['sums', 'storage', 6], ['cells', 'storage', 7], ['slots', 'storage', 10],
    ])
    const merge = build('mergeChildren', [['cells', 'storage', 7], ['level', 'uniform', 8]])
    const force = build('farForce', [
      ['positions', 'read-only-storage', 0], ['box', 'storage', 2], ['settings', 'uniform', 3], ['cells', 'storage', 7], ['forces', 'storage', 9],
    ])
    return {
      box,
      cells,
      // Return the grid's borrowed slot buffer for the near-field pass of this step.
      encode (pass, positions, bounds, alpha, strength, offsetX, offsetY, precise, forces, seed, slotCount): Buffer {
        const bytes = slotGroups * slotCount * 4
        if (!slots || slots.byteLength < bytes) {
          const replacement = device.createBuffer({ id: 'repulsion-near-slots', byteLength: bytes, usage: Buffer.STORAGE })
          slots?.destroy()
          slots = replacement
        }
        words[2] = Number(precise)
        values.set([alpha, strength, offsetX, offsetY], 4)
        words[8] = slotCount
        values[9] = seed
        settings.write(words)
        fit.dispatch(pass, { x: 1, bindings: { bounds, box, settings } })
        bin.dispatch(pass, { ...pointGroups, bindings: { positions, box, settings, heads, next, sums } })
        leaf.dispatch(pass, { x: Math.ceil(leafCount / 64), bindings: { positions, box, settings, heads, next, sums, cells, slots } })
        for (const level of levels) merge.dispatch(pass, { x: Math.ceil(level.count / 64), bindings: { cells, level: level.params } })
        force.dispatch(pass, { ...pointGroups, bindings: { positions, box, settings, cells, forces } })
        return slots
      },
      destroy (): void { slots?.destroy(); scope.destroy() },
    }
  } catch (error) { scope.destroy(); throw error }
}
