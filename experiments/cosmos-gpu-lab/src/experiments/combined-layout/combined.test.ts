import { expect, it } from 'vitest'
import { createCombinedSession } from './session'
import { cool, createGraph, STAGES } from './data'
import { createOracle } from './reference'
it('cools after every tick using Cosmos decay and preserves pinned positions in the scalar sequence', () => {
  let alpha = 1
  for (let i = 0; i < 100; i++) alpha = cool(alpha, 100)
  expect(alpha).toBeCloseTo(0.001, 12)
  const { graph, input } = createGraph({ fixture: 'pinned', count: 16, decay: 100 })
  const oracle = createOracle(graph, input)
  let points = input.points
  for (const stage of STAGES) points = oracle.stage(stage, points, 1, 0).positions
  expect(points).toEqual(oracle.tick(input.points, 1, 0))
  expect(points.slice(0, 4)).toEqual(input.points.slice(0, 4))
  expect(points.slice(-4)).toEqual(input.points.slice(-4))
})
for (const fixture of ['chain', 'star', 'communities', 'pinned'] as const) {
  it(`${fixture}: combines four resident force stages, cooling and a non-destructive probe`, async () => {
    const s = await createCombinedSession({ fixture, count: 32, decay: 20 }, () => document.createElement('canvas'))
    try {
      expect(s.errors).toEqual({})
      for (let i = 0; i < 20; i++) {
        const row = await s.step()
        expect(row.complete, JSON.stringify(s.errors)).toBe(true)
        for (const result of row.results) {
          expect(result.stages.map(c => c.stage)).toEqual(STAGES)
          expect(result.metrics.shape.finite).toBe(true)
          if (result.name === 'webgpu') expect(result.valid, JSON.stringify({ tick: row.tick, result })).toBe(true)
        }
      }
      // Exercise resident link/point rendering through the shared pass as well.
      for (const lane of s.lanes) lane.backend.render([0, 0, 1 / 100, 1 / 100])
      const before = s.lanes.map(l => l.positions.slice()); const cpu = s.cpu().slice(); const alpha = s.alpha()
      const probe = await s.probe()
      expect(probe.alpha).toBe(1); expect(probe.complete).toBe(true)
      expect(probe.results.find(r => r.name === 'webgpu')!.valid).toBe(true)
      expect(s.rows).toHaveLength(20); expect(s.alpha()).toBe(alpha); expect(s.cpu()).toEqual(cpu)
      for (const [i, lane] of s.lanes.entries()) expect((await lane.backend.read()).positions).toEqual(before[i])
    } finally { s.destroy() }
  })
}
