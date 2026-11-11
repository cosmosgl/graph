import { expect, it } from 'vitest'
import { createFixture } from '../many-body/data'
import { compareArray } from '../many-body/reference'
import { buildReference, frameFor, layout } from '../many-body-grid/data'
import { createGraph, STAGES } from './data'
import { createOracle } from './reference'
import { createCombinedWebGPU } from './webgpu'
import { forceSettings, createSamplingPolicy, wantedSamples, affordableSamples } from './production-settings'
import { createGridStudy } from './grid-study'

it('mirrors production sample tiers, affordable caps and two-measurement hysteresis', () => {
  expect(forceSettings('samples32', 8192).samples).toBe(32)
  expect(forceSettings('varied32', 8192).variation).toEqual([1, 1.2])
  expect([8192, 32768, 100000, 200000].map(affordableSamples)).toEqual([64, 16, 16, 8])
  expect(wantedSamples({ points: 100, overflow: [1, 0, 0] })).toBe(8)
  const p = createSamplingPolicy(8192)
  expect(p.samples).toBe(32)
  expect(p.collect({ points: 0, overflow: [0, 0, 0] })).toEqual({ wanted: 32, applied: 32, changed: false })
  expect(() => p.collect({ points: 100, overflow: [1, 2, 0] })).toThrow('Invalid occupancy')
  expect(p.collect({ points: 100, overflow: [100, 100, 100] }).applied).toBe(64)
  expect(p.collect({ points: 100, overflow: [0, 0, 0] }).applied).toBe(64)
  expect(p.collect({ points: 100, overflow: [0, 0, 0] }).applied).toBe(8)
})
for (const preset of ['samples32', 'varied32', 'adaptive'] as const) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${preset}: checked resident history and frozen-frame acceptance`, async () => {
    const s = await createGridStudy(document.createElement('canvas'), { warmups: 0, samples: 4, frames: 4 }, 'layout-acceptance')
    try {
      await s.run([{
        count: 8192,
        fixture: 'communities',
        distribution: 'clusters',
        historyTicks: 40,
        decay: 100,
        checkpointEvery: 10,
        preset,
        candidate: 'cached-small',
        springOptimization: 'prefetch',
        repulsionPolicy: 'production',
      }],
      { cancelled: () => false, progress: () => {} })
      const row = s.report.rows[0]
      expect(s.report.error, JSON.stringify(s.report.failure)).toBeUndefined(); expect(s.report.status).toBe('complete')
      expect(row.checkpoints!.every(c => c.valid)).toBe(true); expect(row.checkpoints!.length).toBeGreaterThanOrEqual(5)
      expect(row.preparation.every(c => c.valid)).toBe(true); expect(row.trials.every(t => t.frames.every(f => f.check.valid))).toBe(true)
      expect(row.sampling!.length > 0).toBe(preset === 'adaptive'); expect(row.cleanup).toEqual([0, 0])
    } finally { s.destroy() }
  }, 120000)
}
for (const preset of ['samples32', 'varied32'] as const) {
  for (const fixture of ['communities', 'star'] as const) {
    it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${preset}/${fixture}: dense complete tick retains independent CPU tolerance`, async () => {
      const { graph, input } = createGraph({ count: 8192, fixture, decay: 100, springPrecision: 'trig' })
      input.points = createFixture('clusters', 8192).points; graph.points = input.points
      input.points[2] = 1; input.points[7] = 1
      const settings = forceSettings(preset, 8192); const oracle = createOracle(graph, input, 'production', settings)
      const b = await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'trig', {
        gpuBounds: true, repulsionPolicy: 'production', forceSettings: settings, springOptimization: 'prefetch', gridAggregation: 'cached-small',
      })
      try {
        let cpu = input.points; b.setGpuFrame!(0)
        for (const stage of STAGES) {
          cpu = oracle.stage(stage, cpu, 1, 0).positions; b.stepStage(stage, 1)
          expect(compareArray((await b.read()).positions, cpu), stage).toMatchObject({ valid: true })
        }
      } finally { b.destroy() }
    })
  }
}
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('GPU occupancy matches the independent cell counts; changing slots retains positions', async () => {
  const { graph, input } = createGraph({ count: 8192, fixture: 'communities', decay: 100, springPrecision: 'trig' })
  input.points = createFixture('clusters', 8192).points; graph.points = input.points
  const settings = forceSettings('adaptive', 8192)
  const b = await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'trig', {
    gpuBounds: true, repulsionPolicy: 'production', forceSettings: settings, adaptiveSampling: true,
  })
  try {
    await expect(b.readOccupancy!()).rejects.toThrow('Request and step')
    b.setGpuFrame!(0); b.stepStage('gravity', 1); const points = (await b.read()).positions
    b.requestOccupancy!(); b.stepStage('repulsion', 1)
    const stats = await b.readOccupancy!(); const frame = frameFor(points, 0, 32)
    const { aggregates } = buildReference(points, frame); const counts = aggregates.filter((_, i) => i % 4 === 2)
    // Only finest-level counts contribute to the occupancy reduction.
    const finest = counts.slice(-(layout(8192).finest ** 2))
    expect(stats).toEqual({ points: 8192, overflow: [8, 16, 32].map(k => finest.reduce((sum, n) => sum + (n > k ? n : 0), 0)) })
    const identity = b.resourceIdentity!(); const before = (await b.read()).positions
    b.setSampling!(64); settings.samples = 64
    expect(b.resourceIdentity!()).toEqual(identity); expect((await b.read()).positions).toEqual(before)
    b.stepTick!(1, 1)
    expect(compareArray((await b.read()).positions, createOracle(graph, input, 'production', settings).tick(before, 1, 1))).toMatchObject({ valid: true })
  } finally { b.destroy() }
})
