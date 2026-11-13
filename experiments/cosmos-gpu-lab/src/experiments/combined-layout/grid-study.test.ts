import { expect, it } from 'vitest'
import { createGridStudy } from './grid-study'
import { frozenSummary } from './frozen-timing'
for (const distribution of ['uniform', 'clusters'] as const) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${distribution}: strict stages, CPU gates and every normal/profile replay`, async () => {
    const study = await createGridStudy(document.createElement('canvas'), { warmups: 0, samples: 4, frames: 4 })
    try {
      await study.run([{ count: 8192, fixture: 'chain', distribution, candidate: 'cached-small', historyTicks: 0 }], {
        cancelled: () => false, progress: () => {},
      })
      const r = study.report; const row = r.rows[0]
      expect(r.error, JSON.stringify({ failure: r.failure, stages: row.stages })).toBeUndefined()
      expect(r.status).toBe('complete'); expect(row.valid).toBe(true)
      expect(row.structure).toEqual({ aggregates: 0, slots: 0, centroids: 0, cpuAggregates: 0, cpuCentroids: 0, bounds: 0 })
      expect(row.trials).toHaveLength(8); expect(row.diagnostic).toHaveLength(8)
      expect(row.trials.every(t => t.frames.length === 4 && t.frames.every(f => f.check.valid))).toBe(true)
      expect(row.work?.some(w => w.dense)).toBe(true)
      expect(frozenSummary(row, r.policy, 0, 'normal').samples).toBe(4)
      expect(row.cleanup).toEqual([0, 0])
    } finally { study.destroy() }
    expect(study.remainingBytes()).toEqual([0, 0])
  })
}
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('checks preparation ticks and cancels between timing batches without leaking', async () => {
  const study = await createGridStudy(document.createElement('canvas'), { warmups: 0, samples: 4, frames: 4 })
  try {
    await study.run([{ count: 256, fixture: 'communities', distribution: 'uniform', candidate: 'cached-small', historyTicks: 20 }], {
      cancelled: () => (study.report.rows[0]?.trials.length ?? 0) >= 3, progress: () => {},
    })
    const row = study.report.rows[0]
    expect(study.report.error, JSON.stringify(study.report.failure)).toBeUndefined()
    expect(study.report.status).toBe('cancelled'); expect(row.preparation).toHaveLength(40)
    expect(row.preparation.every(c => c.valid)).toBe(true); expect(row.trials).toHaveLength(3)
    expect(frozenSummary(row, study.report.policy, 0, 'normal').median).toBeNull()
  } finally { study.destroy() }
  expect(study.remainingBytes()).toEqual([0, 0])
})
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('accepts the corrected dense-community CPU verdict and continues independent cases', async () => {
  const study = await createGridStudy(document.createElement('canvas'), { warmups: 0, samples: 4, frames: 1 })
  try {
    await study.run([
      { count: 4096, fixture: 'communities', distribution: 'clusters', candidate: 'baseline', historyTicks: 0 },
      { count: 256, fixture: 'chain', distribution: 'uniform', candidate: 'cached-small', historyTicks: 0 },
    ], { cancelled: () => false, progress: () => {} })
    const r = study.report; const dense = r.rows[0]
    expect(dense.stages.every(s => s.cpuValid && !s.positions && !s.forces)).toBe(true)
    expect(dense.wholeCPU?.valid).toBe(true); expect(dense.valid).toBe(true); expect(r.status).toBe('complete')
    expect(r.rows[1].valid).toBe(true); expect(r.rows.every(row => row.cleanup?.every(n => n === 0))).toBe(true)
  } finally { study.destroy() }
})
