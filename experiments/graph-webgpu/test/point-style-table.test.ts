import { expect, it } from 'vitest'
import { interruptedPointTable, packPointStyles, pointStride } from '../src/modules/Points/style-table'

const bytes = pointStride * 4
const count = 101
const overrides = new Map([[0, 12], [50, 24], [100, 48]])
function writeDiameter (id: number, target: Float32Array, offset: number): void {
  target[offset + 4] = overrides.get(id) ?? 8
  target[offset + 18] = 0.2
}

it('uses one shared record for uniform data even when a dense table fits', () => {
  const table = packPointStyles(count, 128 * bytes, true, (_id, target, offset) => { target[offset + 4] = 8 })
  expect(table.ids?.length).toBe(0)
  expect(table.attributes.byteLength).toBe(bytes)
})

it('recovers the shared style even when the first, middle and last points are distinct exceptions', () => {
  const table = packPointStyles(count, 4 * bytes, false, writeDiameter)
  expect(table.ids).toEqual(Uint32Array.of(0, 50, 100))
  expect(table.attributes.byteLength).toBe(4 * bytes)
  const keys = new Uint32Array(table.attributes.buffer)
  expect(table.attributes[4]).toBe(8)
  for (const [slot, id] of table.ids!.entries()) {
    expect(keys[(slot + 1) * pointStride + 18]).toBe(id)
    expect(table.attributes[(slot + 1) * pointStride + 4]).toBe(overrides.get(id))
  }
  expect(() => packPointStyles(count, 3 * bytes, false, writeDiameter)).toThrow(/storage binding/)
})

it('keeps added slots at their new target when freezing an interrupted sparse transition', () => {
  expect(interruptedPointTable(Uint32Array.of(1), Uint32Array.of(5), 8, 10, 8 * bytes))
    .toEqual({ ids: Uint32Array.of(1, 5, 8, 9), mixShared: true })
  expect(interruptedPointTable(Uint32Array.of(1), Uint32Array.of(5), 2, 10, 8 * bytes))
    .toEqual({ ids: Uint32Array.of(0, 1, 5), mixShared: false })
})
