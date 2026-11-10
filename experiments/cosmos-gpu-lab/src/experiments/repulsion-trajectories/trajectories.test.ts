import { expect, it } from 'vitest'
import { createTrajectorySession } from './session'
for (const fixture of ['uniform', 'clusters', 'coincident'] as const) {
  it(`${fixture}: corrected GPU paths pass 20 independent local ticks at 512 points`, async () => {
    const s = await createTrajectorySession({ fixture, count: 512, slots: 8, precise: true }, () => document.createElement('canvas'))
    try {
      expect(s.errors).toEqual({})
      for (let tick = 0; tick < 20; tick++) {
        const row = await s.step()
        expect(row.complete, JSON.stringify(row.errors)).toBe(true)
        for (const check of row.checks.filter(c => c.name !== 'webgl')) {
          expect(check.valid, JSON.stringify({ tick: row.tick, check })).toBe(true)
          expect(check.shape.finite).toBe(true)
        }
      }
      expect(s.rows).toHaveLength(20)
    } finally { s.destroy() }
  })
}
