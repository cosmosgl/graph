import { expect, it } from 'vitest'
import { COLLISION } from './data'
import { createCollisionSession } from './session'
import { measureCollisionCost, collisionCostSummary } from './timing'
for (const mode of ['collision', 'combined'] as const) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${mode}: repeated same-input ticks, original scalar budgets and batched timing`, async () => {
    const settings = { fixture: 'uniform' as const, count: 128, mode, alpha: 1, collision: { ...COLLISION, iterations: 2 } }
    const session = await createCollisionSession(settings, () => document.createElement('canvas'))
    try {
      expect(session.report.errors).toEqual({})
      for (let i = 0; i < 10; i++) await session.step()
      expect(session.report.rows.every(r => r.complete)).toBe(true)
      expect(session.report.rows.every(r => r.checks.webgpu?.valid), JSON.stringify(session.report.rows.filter(r => !r.checks.webgpu?.valid))).toBe(true)
      const before = session.cpu().slice(); const lanes = session.lanes.map(l => l.positions.slice())
      const report = await measureCollisionCost(session.settings, before, () => {}, () => false, { warmups: 1, samples: 2, frames: 2, blocks: 1 })
      expect(report.status, JSON.stringify(report.errors)).toBe('complete')
      expect(report.preflight.filter(p => p.api === 'webgpu').every(p => p.gate.valid), JSON.stringify(report.preflight)).toBe(true)
      expect(report.trials.filter(t => t.api === 'webgpu').every(t => t.valid), JSON.stringify(report.trials)).toBe(true)
      if (report.trials.filter(t => t.api === 'webgpu').every(t => t.timing.timerStatus === 'valid')) {
        expect(collisionCostSummary(report, 'webgpu', 0).accepted).toBe(true)
      }
      expect(session.cpu()).toEqual(before); expect(session.lanes.map(l => l.positions)).toEqual(lanes)
      await session.replay()
      expect(session.report.replays.every(r => r.reproduced && r.restored)).toBe(true)
      expect(session.cpu()).toEqual(before); expect(session.lanes.map(l => l.positions)).toEqual(lanes)
      report.trials[0].valid = false
      expect(collisionCostSummary(report, report.trials[0].api, 0).accepted).toBe(false)
    } finally { session.destroy() }
  }, 120000)
}
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('masked composition checks every collision correction and retains absent positions', async () => {
  const session = await createCollisionSession({
    fixture: 'masks', count: 8, mode: 'combined', alpha: 1, arithmetic: 'native', collision: { ...COLLISION },
  }, () => document.createElement('canvas'))
  try {
    expect(session.report.errors).toEqual({})
    for (let i = 0; i < 10; i++) await session.step()
    expect(session.report.rows.every(r => r.complete && Object.values(r.checks).every(c => c.valid))).toBe(true)
    const stages = session.report.rows[0].checks.webgpu!.stages
    expect(stages.filter(c => c.stage === 'incoming' || c.stage === 'outgoing').every(c => c.absentSpringTargets === 2)).toBe(true)
    expect(stages.find(c => c.stage === 'collision')!.absentSpringTargets).toBe(0)
  } finally { session.destroy() }
}, 120000)
