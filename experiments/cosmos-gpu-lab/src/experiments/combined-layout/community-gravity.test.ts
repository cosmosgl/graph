import { expect, it } from 'vitest'
import { createCombinedSession } from './session'
import { isolateTickFailure } from './tick-isolation'
// The negative-control point is the observed M3 counterexample; another adapter needs its own audit.
const nativeTest = it.skipIf(!import.meta.env.LAB_NATIVE_GPU || Number(import.meta.env.LAB_SCALE_COUNT) !== 8192)
nativeTest('replays the aligned communities negative control and validates the gravity correction', async () => {
  const session = await createCombinedSession({
    fixture: 'communities',
    count: 8192,
    decay: 100,
    checkpointEvery: 10,
    springPrecision: 'aligned',
  }, () => document.createElement('canvas'))
  try {
    const row = await session.step()
    const gpu = row.results.find(r => r.name === 'webgpu')!
    expect(row.complete).toBe(true)
    expect(gpu.stages.every(s => s.valid)).toBe(true)
    expect(gpu.wholeTick?.failures).toBe(1)
    const saved = session.lanes.map(l => l.positions.slice()); const alpha = session.alpha()
    const report = await isolateTickFailure(session)
    expect(report.baselineMatchesCapture).toBe(true)
    expect(report.components.map(c => c.point)).toEqual([5855])
    expect(report.gravity?.forcesMatchUninstrumented).toBe(true)
    expect(report.gravity?.fields.find(f => f.field === 'angle')?.differing).toBeGreaterThan(0)
    expect(report.refinedGravity?.forcesMatchUninstrumented).toBe(true)
    expect(report.refinedGravity?.fields.every(f => f.differing === 0)).toBe(true)
    expect(report.trigValidation?.differing).toEqual([0, 0, 0])
    expect(report.ablations.find(a => a.name === 'refined trigonometry + rounded gravity integration')?.positions.valid).toBe(true)
    expect(session.lanes.map(l => l.positions)).toEqual(saved)
    expect(session.alpha()).toBe(alpha)
  } finally { session.destroy() }
  const fixed = await createCombinedSession({
    fixture: 'communities',
    count: 8192,
    decay: 100,
    checkpointEvery: 10,
    springPrecision: 'trig',
  }, () => document.createElement('canvas'))
  try {
    const row = await fixed.step(); expect(fixed.errors).toEqual({})
    expect(row.results.find(r => r.name === 'webgpu')?.valid).toBe(true)
  } finally { fixed.destroy() }
}, 180000)
