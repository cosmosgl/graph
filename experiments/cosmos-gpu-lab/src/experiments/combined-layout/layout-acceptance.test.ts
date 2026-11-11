import { expect, it } from 'vitest'
import { createGridStudy } from './grid-study'
import { frozenSummary } from './frozen-timing'

for (const fixture of ['communities', 'star'] as const) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${fixture}: hub prefetch and cached grid compose under the production policy`, async () => {
    const s = await createGridStudy(document.createElement('canvas'), { warmups: 0, samples: 4, frames: 4 })
    try {
      await s.run([{
        count: 8192,
        fixture,
        distribution: 'clusters',
        historyTicks: 2,
        decay: 100,
        candidate: 'cached-small',
        springOptimization: 'prefetch',
        repulsionPolicy: 'production',
      }],
      { cancelled: () => false, progress: () => {} })
      const r = s.report; const row = r.rows[0]
      expect(r.error, JSON.stringify(r.failure)).toBeUndefined(); expect(r.status).toBe('complete')
      expect(row.method).toBe('hierarchical'); expect(row.preparation).toHaveLength(4)
      expect(row.preparation.every(c => c.valid)).toBe(true); expect(row.stages.every(c => c.cpuValid)).toBe(true)
      expect(row.trials.every(t => t.frames.every(f => f.check.valid))).toBe(true)
      expect(row.structure && Object.values(row.structure).every(v => v === 0)).toBe(true)
      expect(row.cleanup).toEqual([0, 0])
    } finally { s.destroy() }
  })
}
for (const decay of [100, 300]) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${decay}: exact-path cooling and full-strength probe accept every normal capture`, async () => {
    const s = await createGridStudy(document.createElement('canvas'), { warmups: 0, samples: 4, frames: 4 })
    try {
      await s.run([{
        count: 64,
        fixture: 'chain',
        distribution: 'uniform',
        historyTicks: decay,
        decay,
        probe: true,
        pinned: false,
        candidate: 'cached-small',
        springOptimization: 'prefetch',
        repulsionPolicy: 'production',
      }],
      { cancelled: () => false, progress: () => {} })
      const r = s.report; const row = r.rows[0]
      expect(r.error, JSON.stringify(r.failure)).toBeUndefined(); expect(r.status).toBe('complete')
      expect(row.method).toBe('exact'); expect(row.tick).toBe(decay); expect(row.alpha).toBe(1)
      expect(row.cooledAlpha).toBeCloseTo(0.001, 10); expect(row.preparation).toHaveLength(decay * 2)
      expect(row.preparation.every(c => c.valid)).toBe(true); expect(row.diagnostic).toHaveLength(0); expect(row.structure).toBeUndefined()
      expect(row.trials.every(t => t.frames.every(f => f.check.valid))).toBe(true)
      expect(frozenSummary(row, r.policy, 1, 'normal').samples).toBe(4); expect(row.cleanup).toEqual([0, 0])
    } finally { s.destroy() }
  })
}
