import { expect, it } from 'vitest'
import { createOracle } from '../combined-layout/reference'
import { COLLISION, createFixture } from './data'
import { parametersFor, sequence } from './backend'
import { expectedTick } from './checks'
import { measureCollisionCost, collisionCostSummary } from './timing'

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('compares center sums with collision retained and rejects an invalid original control', async () => {
  const settings = {
    fixture: 'clusters' as const,
    count: 512,
    mode: 'combined' as const,
    arithmetic: 'native' as const,
    alpha: 1,
    collision: { ...COLLISION, iterations: 4 },
  }
  const { input, graph } = createFixture(settings.fixture, settings.count)
  const parameters = parametersFor(settings); const oracle = createOracle(graph, input, 'production', parameters)
  const stages = sequence(settings.mode, parameters)
  const startTick2 = expectedTick(oracle, stages, input.points, 1).positions
  for (const frozen of [input.points, startTick2]) {
    const report = await measureCollisionCost(settings, frozen, () => {}, () => false,
      { warmups: 1, samples: 2, frames: 2, blocks: 1 }, frozen === input.points ? 0 : 1, 'center-reduction')
    expect(report.status, JSON.stringify(report.errors)).toBe('complete')
    expect(report.comparison).toBe('center-reduction')
    expect(report.preflight).toHaveLength(2)
    expect(report.preflight.every(p => p.api === 'webgpu' && p.gate.stages.filter(s => s.stage === 'collision').length === 4)).toBe(true)
    expect(report.preflight.find(p => p.enabled)!.gate.valid).toBe(true)
    expect(report.trials.filter(t => t.enabled).every(t => t.valid)).toBe(true)
    const originalPasses = report.preflight.find(p => !p.enabled)!.gate.valid
    if (report.trials.every(t => t.timing.timerStatus === 'valid')) {
      expect(collisionCostSummary(report, 'webgpu', 0).accepted).toBe(originalPasses)
    }
    if (frozen === input.points) expect(originalPasses).toBe(true)
    // Other GPUs may evaluate the original f32 tree differently. Whenever that
    // control fails, it must retain evidence and cannot supply a speed estimate.
    if (!originalPasses) {
      expect(report.failure).toBeDefined(); expect(collisionCostSummary(report, 'webgpu', 0).deltaMs).toBeNull()
    }
  }
}, 120000)
