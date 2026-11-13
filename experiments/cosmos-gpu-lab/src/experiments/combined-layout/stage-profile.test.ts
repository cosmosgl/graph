import { expect, it } from 'vitest'
import { PROFILE_STAGES, stageDurations } from './stage-timing'
import { createControlledProfiler, profileOrder, profileSummary } from './controlled-profile'
it('uses only within-pass endpoint pairs even when different passes have unrelated timestamp offsets', () => {
  expect(stageDurations([100000000n, 103000000n, 1n, 2000001n], 2)).toEqual([3, 2])
  expect(stageDurations([5n, 4n], 1)).toBeNull()
  expect(stageDurations([1n], 1)).toBeNull()
  expect(stageDurations([0n, 0n], 1)).toEqual([0])
})
it('balances each lane/method combination at every position in the eight accepted rounds', () => {
  const orders = Array.from({ length: 8 }, (_, round) => profileOrder(round))
  for (let position = 0; position < 4; position++) {
    for (let trial = 0; trial < 4; trial++) expect(orders.filter(order => order[position] === trial)).toHaveLength(2)
  }
})
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('replays a frozen resized graph through all profile passes without changing CPU tolerance', async () => {
  const p = await createControlledProfiler({ fixture: 'star', count: 128, peakCount: 256, history: true }, () => document.createElement('canvas'))
  try {
    await p.run({ cancelled: () => false, progress: () => {} })
    const r = p.report
    expect(r.error, JSON.stringify(r)).toBeUndefined(); expect(r.status).toBe('complete')
    expect(r.capture?.capacities).toEqual([128, 256])
    expect(r.preparation).toEqual({ resizes: 13, frames: 14, valid: true })
    expect(r.anchors?.every(c => c.valid)).toBe(true)
    expect(r.trials).toHaveLength(40); expect(r.trials.every(t => t.check.valid)).toBe(true)
    for (const t of r.trials.filter(t => t.kind === 'profile')) {
      expect(t.stages?.map(s => s.name)).toEqual(PROFILE_STAGES)
      if (t.timing.timerStatus === 'valid') expect(t.stages?.reduce((sum, s) => sum + s.gpuMs!, 0)).toBe(t.timing.batchGpuMs)
    }
    expect(profileSummary(r, 0, 'normal').samples).toBe(8)
    expect(profileSummary(r, 1, 'profile', 'incoming.force').samples).toBe(8)
  } finally { p.destroy() }
  expect(p.remainingBytes()).toEqual([0, 0])
})
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('cancels between trials and exports only partial timing evidence', async () => {
  const p = await createControlledProfiler({ fixture: 'chain', count: 32, peakCount: 32, history: false }, () => document.createElement('canvas'))
  try {
    await p.run({ cancelled: () => p.report.trials.length >= 10, progress: () => {} })
    expect(p.report.status).toBe('cancelled'); expect(p.report.trials).toHaveLength(10)
    expect(profileSummary(p.report, 0, 'normal').gpuMs).toBeNull()
    expect(p.report.trials.every(t => t.check.valid)).toBe(true)
  } finally { p.destroy() }
  expect(p.remainingBytes()).toEqual([0, 0])
})
