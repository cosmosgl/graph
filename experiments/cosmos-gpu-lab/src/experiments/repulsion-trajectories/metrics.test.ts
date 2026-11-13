import { expect, it } from 'vitest'
import { displacement, shape } from './metrics'
it('measures Euclidean drift including pinned points while excluding absent sentinels', () => {
  const a = new Float32Array([3, 4, 0, 0, 0, 2, 1, 0, NaN, NaN, 0, 1])
  const b = new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, NaN, NaN, 0, 1])
  expect(displacement(a, b)).toEqual({ rms: Math.sqrt(29 / 2), max: 5, compared: 2 })
  expect(shape(a)).toEqual({ present: 2, center: [1.5, 3], radius: Math.sqrt(3.25), finite: true })
})
it('keeps non-finite present coordinates visible and defines empty input', () => {
  expect(shape(new Float32Array([NaN, 0, 0, 0])).finite).toBe(false)
  expect(displacement(new Float32Array([NaN, 0, 0, 0]), new Float32Array(4)).rms).toBe(Infinity)
  expect(shape(new Float32Array())).toEqual({ present: 0, center: [0, 0], radius: 0, finite: true })
})
