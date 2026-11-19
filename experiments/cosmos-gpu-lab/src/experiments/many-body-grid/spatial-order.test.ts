import { expect, it } from 'vitest'
import { createFixture } from '../many-body/data'
import { cellOf, frameFor, layout } from './data'
import { orderTargetsByCell, spatialOrderShader } from './spatial-order'
import { fastForceSource } from './fast-force'

for (const fixture of ['uniform', 'clusters', 'edge-cases'] as const) {
  it(`orders ${fixture} targets by cell without losing identities`, () => {
    const input = createFixture(fixture, 513); const frame = frameFor(input.points, 0)
    const order = orderTargetsByCell(input.points, frame); const n = layout(order.length).finest
    expect(new Set(order).size).toBe(order.length)
    expect(Array.from(order).every(i => i >= 0 && i < order.length)).toBe(true)
    let previous = -1
    for (const index of order) {
      const i = index * 4
      const key = input.points[i + 3] > 0.5 ? n * n : cellOf(input.points[i], input.points[i + 1], n, frame.bounds)
      expect(key).toBeGreaterThanOrEqual(previous); previous = key
    }
  })
}
it('maps invocations to original target indices', () => {
  const shader = spatialOrderShader(fastForceSource('corrected'))
  expect(shader).toContain('targetIndex = targetOrder[dispatchIndex]')
  expect(shader).toContain('@binding(12) var<storage, read> targetOrder')
})
