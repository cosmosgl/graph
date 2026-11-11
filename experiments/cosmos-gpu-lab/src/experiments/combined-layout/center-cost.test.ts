import { expect, it } from 'vitest'
import { createGraph } from './data'
import { centerCostSummary, measureCenterCost, type CenterCostReport } from './center-cost'
it('keeps incomplete, numerically failing, invalid-timer and failed warmup blocks out of summaries', () => {
  const settings: CenterCostReport['settings'] = {
    count: 4,
    fixture: 'chain',
    distribution: 'uniform',
    ticks: 100,
    checkpointEvery: 10,
    preset: 'varied32',
    pinned: true,
    center: 1,
  }
  const report: CenterCostReport = {
    settings,
    alpha: 1,
    tick: 0,
    samples: 32,
    strength: 1,
    recordedAt: '',
    browser: '',
    input: new Float32Array(16),
    policy: { warmups: 1, samples: 2, frames: 4, blocks: 1 },
    status: 'complete',
    devices: {},
    preflight: [],
    trials: [],
    errors: [],
  }
  for (const center of [0, 1]) {
    report.preflight.push({
      api: 'webgpu',
      center,
      gate: {
        valid: true, stages: [], wholeTick: { valid: true, failures: 0, maxError: 0, worstIndex: -1 },
      },
    })
  }
  for (let round = 0; round < 3; round++) {
    for (const center of [0, 1]) {
      report.trials.push({
        block: 0,
        round,
        warmup: round === 0,
        api: 'webgpu',
        center,
        valid: true,
        mismatchedFrames: 0,
        timing: { operations: 4, batchSubmitMs: 0, batchCompletionMs: 0, batchGpuMs: 4 * (round + 1 + center), timerStatus: 'valid' },
      })
    }
  }
  expect(centerCostSummary(report, 'webgpu', 0)).toMatchObject({ accepted: true, offMs: 2.5, onMs: 3.5, deltaMs: 1 })
  report.trials[0].valid = false
  expect(centerCostSummary(report, 'webgpu', 0).accepted).toBe(false)
  report.trials[0].valid = true; report.trials[0].timing.timerStatus = 'disjoint'
  expect(centerCostSummary(report, 'webgpu', 0).accepted).toBe(false)
  report.trials[0].timing.timerStatus = 'valid'; report.preflight[0].gate.valid = false
  expect(centerCostSummary(report, 'webgpu', 0).accepted).toBe(false)
  report.preflight[0].gate.valid = true; report.trials.pop()
  expect(centerCostSummary(report, 'webgpu', 0).accepted).toBe(false)
})
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('times paired center off/on frames only after unchanged scalar and exact-output gates', async () => {
  const settings = {
    count: 128,
    fixture: 'chain' as const,
    distribution: 'uniform' as const,
    ticks: 100,
    checkpointEvery: 10,
    preset: 'varied32' as const,
    pinned: true,
    center: 1,
  }
  const { input } = createGraph({ count: 128, fixture: 'chain', decay: 100 })
  for (let i = 0; i < input.points.length; i += 4) { input.points[i] += 2048; input.points[i + 1] += 2048 }
  input.points[2] = 1
  const report = await measureCenterCost(settings, input.points, 1, 0, 32, () => {}, () => false,
    { warmups: 0, samples: 2, frames: 2, blocks: 1 })
  expect(report.errors).toEqual([]); expect(report.status).toBe('complete')
  expect(report.preflight.every(p => p.gate.valid), JSON.stringify(report.preflight)).toBe(true)
  expect(report.trials.every(t => t.valid), JSON.stringify(report.trials)).toBe(true)
  for (const api of ['webgl', 'webgpu'] as const) {
    expect(centerCostSummary(report, api, 0).accepted).toBe(true)
    const trial = report.trials.find(t => t.api === api)!
    trial.valid = false
    expect(centerCostSummary(report, api, 0).accepted).toBe(false)
  }
}, 120000)
