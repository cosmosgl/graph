import { expect, it } from 'vitest'
import { createHubTrajectory } from './hub-trajectory'
import { createHubStudy } from './hub-study'
import { prefetchSpringSources } from './hub-spring-source'
it('rejects invalid shader thresholds before creating resources', () => {
  for (const threshold of [0, 63, 64.5, Infinity, 16385]) expect(() => prefetchSpringSources(threshold)).toThrow('threshold')
})
for (const pinned of [false, true]) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`cooled trajectory and batched replay (${pinned ? 'pinned' : 'unpinned'})`, async () => {
    const t = await createHubTrajectory(document.createElement('canvas'), {
      count: 256, degree: 129, threshold: 64, pinned, decay: 100, checkpointEvery: 10,
    })
    try {
      await t.run({ cancelled: () => false, progress: () => {} })
      expect(t.report.error, JSON.stringify(t.report.failure)).toBeUndefined()
      expect(t.report.status).toBe('complete'); expect(t.report.checkpoints).toHaveLength(12)
      expect(t.report.checkpoints.every(c => c.valid && c.stages.every(s => s.valid))).toBe(true)
      expect(t.report.checkpoints.at(-1)?.probe).toBe(true)
      expect(t.report.cleanup).toEqual([0, 0])
      const capture = t.finalCapture(true)
      expect(capture.tick).toBe(100); expect(capture.alpha).toBe(1)
      expect(Array.from(capture.positions)).toEqual(t.report.final)
      expect(t.finalCapture(false).alpha).toBeCloseTo(0.001, 10)
      const s = await createHubStudy(document.createElement('canvas'), { warmups: 0, samples: 4, frames: 4, diagnostics: false, batched: true })
      try {
        await s.run([{ count: 256, degree: 129, threshold: 1024, pinned, optimization: 'prefetch' }], {
          cancelled: () => false, progress: () => {}, capture,
        })
        expect(s.report.error).toBeUndefined(); expect(s.report.status).toBe('complete')
        expect(s.report.rows[0].tick).toBe(100); expect(s.report.rows[0].trials).toHaveLength(8)
        expect(s.report.rows[0].valid).toBe(true)
        expect(s.report.rows[0].trials.every(t => t.frames.length === 4 && t.frames.every(f => f.check.valid))).toBe(true)
      } finally { s.destroy() }
    } finally { t.destroy() }
  }, 120000)
}
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('stops between resident ticks and releases both lanes', async () => {
  const t = await createHubTrajectory(document.createElement('canvas'), {
    count: 128, degree: 127, threshold: 1024, pinned: false, decay: 100, checkpointEvery: 10,
  })
  await t.run({ cancelled: () => t.report.tick >= 3, progress: () => {} })
  expect(t.report.status).toBe('cancelled'); expect(t.report.tick).toBe(3)
  expect(t.report.cleanup).toEqual([0, 0]); expect(() => t.finalCapture(true)).toThrow('passing')
})

// Bounded native research gate: disabled in routine runs. No timing assertions.
const research = it.skipIf(!import.meta.env.LAB_NATIVE_GPU || Number(import.meta.env.LAB_SCALE_COUNT) !== 8192)
for (const degree of [1024, 4096, 8191]) {
  for (const pinned of [false, true]) {
    for (const decay of [100, 300]) {
      research(`8192 points / degree ${degree} / ${pinned ? 'pinned' : 'unpinned'} / ${decay} ticks`, async () => {
        const t = await createHubTrajectory(document.createElement('canvas'), {
          count: 8192, degree, pinned, decay, threshold: 1024, checkpointEvery: 10,
        })
        try {
          await t.run({ cancelled: () => false, progress: () => {} })
          // eslint-disable-next-line no-console
          console.info('HUB_TRAJECTORY', JSON.stringify({
            settings: t.report.settings,
            status: t.report.status,
            error: t.report.error,
            checks: t.report.checkpoints.length,
            valid: t.report.checkpoints.every(c => c.valid),
            cleanup: t.report.cleanup,
            failure: t.report.failure ? { tick: t.report.failure.tick, stage: t.report.failure.stage } : undefined,
          }))
          expect(t.report.error, JSON.stringify(t.report.failure)).toBeUndefined()
          expect(t.report.status).toBe('complete'); expect(t.report.checkpoints.every(c => c.valid)).toBe(true)
        } finally { t.destroy() }
      }, 300000)
    }
  }
}
