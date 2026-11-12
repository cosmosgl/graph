import { expect, it } from 'vitest'
import { COLLISION } from './data'
import { createCollisionSession } from './session'
import { measureCollisionCost, collisionCostSummary } from './timing'
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('preallocates precision controls, validates captures, and rejects a failing native comparison', async () => {
  const settings = {
    fixture: 'clusters' as const,
    count: 512,
    topology: 'star' as const,
    mode: 'combined' as const,
    evolution: 'independent' as const,
    arithmetic: 'native' as const,
    alpha: 1,
    coolingTicks: 300,
    collision: { ...COLLISION, iterations: 4 },
  }
  const session = await createCollisionSession(settings, () => document.createElement('canvas'))
  const initial = session.cpu().slice(); let tick5: Float32Array; let alpha: number
  try {
    expect(session.report.errors).toEqual({})
    for (let i = 0; i < 4; i++) await session.step()
    tick5 = session.lanes.find(l => l.api === 'webgpu')!.positions.slice(); alpha = session.alpha()
  } finally { session.destroy() }
  for (const [frozen, value, tick] of [[initial, 1, 0], [tick5, alpha, 4]] as const) {
    const report = await measureCollisionCost({ ...settings, alpha: value }, frozen, () => {}, () => false,
      { warmups: 1, samples: 2, frames: 2, blocks: 1 }, tick, 'collision-precision')
    expect(report.status, JSON.stringify(report.errors)).toBe('complete')
    expect(report.preflight).toHaveLength(2)
    expect(report.preflight.every(p => p.api === 'webgpu' && p.gate.stages.filter(s => s.stage === 'collision').length === 4)).toBe(true)
    expect(report.preflight.find(p => p.enabled)!.gate.valid).toBe(true)
    expect(report.trials.filter(t => t.enabled).every(t => t.valid && t.failedFrames === 0)).toBe(true)
    const nativeValid = report.preflight.find(p => !p.enabled)!.gate.valid
    if (tick === 0) expect(nativeValid).toBe(true)
    if (report.trials.every(t => t.timing.timerStatus === 'valid')) expect(collisionCostSummary(report, 'webgpu', 0).accepted).toBe(nativeValid)
    if (!nativeValid) {
      expect(report.failure).toBeDefined(); expect(collisionCostSummary(report, 'webgpu', 0).deltaMs).toBeNull()
    }
  }
}, 120000)
