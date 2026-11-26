import { expect, it } from 'vitest'
import { workgroupGrid } from '../src/modules/Shared/compute'

it('preserves single-row jobs and balances larger jobs within the two-dimensional limit', () => {
  expect(workgroupGrid(0, 4)).toEqual({ x: 0, y: 1 })
  expect(workgroupGrid(4, 4)).toEqual({ x: 4, y: 1 })
  expect(workgroupGrid(5, 4)).toEqual({ x: 3, y: 2 })
  expect(workgroupGrid(16, 4)).toEqual({ x: 4, y: 4 })
  expect(() => workgroupGrid(17, 4)).toThrow(/two-dimensional workgroup limit/)
  expect(workgroupGrid(Math.ceil(10_000_000 / 64), 65535)).toEqual({ x: 52084, y: 3 })
})
