import { expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { createFixture } from '../many-body/data'
import { cellOf } from './data'
import { frozenForce } from './frozen-resident-force'

it('evaluates one distant mass at the point, the cell center or the four fixed-stencil corners', async () => {
  const input = createFixture('coincident', 257); const points = input.points
  const x = 48; const y = 35; points.set([x, y, 0, 0])
  for (let i = 1; i < 257; i++) points.set([-64, -48], i * 4)
  points[7] = 1
  const push = (x: number, y: number, axis: number): number =>
    255 * (axis ? y + 48 : x + 64) / ((x + 64) ** 2 + (y + 48) ** 2)
  const device = await createDevice('webgpu')
  try {
    for (const mode of ['per-point', 'cell-center', 'four-corners'] as const) {
      const { forces, box } = await frozenForce(device, input, mode)
      const key = cellOf(x, y, 8, box); const size = box[2] / 8
      const left = box[0] + (key % 8) * size; const bottom = box[1] + Math.floor(key / 8) * size
      const u = (x - left) / size; const v = (y - bottom) / size
      for (const axis of [0, 1]) {
        let expected = push(x, y, axis)
        if (mode === 'cell-center') expected = push(left + size / 2, bottom + size / 2, axis)
        if (mode === 'four-corners') {
          expected = (1 - v) * ((1 - u) * push(left, bottom, axis) + u * push(left + size, bottom, axis)) +
            v * ((1 - u) * push(left, bottom + size, axis) + u * push(left + size, bottom + size, axis))
        }
        expect(Math.abs(forces[axis] - expected), mode).toBeLessThan(5e-5)
      }
      expect([...forces.slice(4, 8)]).toEqual([0, 0, 0, 0])
    }
  } finally { device.destroy() }
})
