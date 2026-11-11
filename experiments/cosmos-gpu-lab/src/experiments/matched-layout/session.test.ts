import { expect, it } from 'vitest'
import { createGraph } from '../combined-layout/data'
import { createOracle } from '../combined-layout/reference'
import { forceSettings } from '../combined-layout/production-settings'
import { createCombinedWebGL } from '../combined-layout/webgl'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import { createMatchedSession, type Settings } from './session'
const base: Settings = { count: 128, fixture: 'chain', distribution: 'uniform', ticks: 20, checkpointEvery: 10, preset: 'varied32', pinned: true }
for (const fixture of ['chain', 'communities', 'star'] as const) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${fixture}: frozen checks, probe and replay restore independent production-frame paths`, async () => {
    const s = await createMatchedSession({ ...base, fixture }, () => document.createElement('canvas'))
    try {
      expect(s.report.errors).toEqual({})
      for (let i = 0; i < base.ticks; i++) expect((await s.step()).complete).toBe(true)
      const checked = s.report.rows.filter(r => Object.keys(r.checks).length)
      expect(checked.map(r => r.tick)).toEqual([1, 10, 20])
      expect(checked.every(r => Object.values(r.checks).every(c => c.restored))).toBe(true)
      expect(checked.every(r => r.checks.webgpu?.valid)).toBe(true)
      const cpu = s.cpu().slice(); const points = s.lanes.map(l => l.positions.slice()); const alpha = s.alpha()
      await s.probe(); await s.replay()
      expect(s.cpu()).toEqual(cpu); expect(s.lanes.map(l => l.positions)).toEqual(points); expect(s.alpha()).toBe(alpha)
      expect(s.report.replays.every(r => r.reproduced && r.restored)).toBe(true)
      expect(s.report.rows.every(r => r.quality.cpu!.shape.finite)).toBe(true)
    } finally { s.destroy() }
  }, 120000)
}
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('adaptive hierarchy uses one shared decision tape and retains failure evidence', async () => {
  const s = await createMatchedSession({
    ...base, count: 4097, fixture: 'communities', distribution: 'clusters', preset: 'adaptive', ticks: 2,
  }, () => document.createElement('canvas'))
  try {
    expect(s.report.errors).toEqual({})
    for (let i = 0; i < 2; i++) expect((await s.step()).complete).toBe(true)
    expect(s.report.method).toBe('hierarchical'); expect(s.report.sampling).toHaveLength(1)
    expect(s.report.rows.every(r => r.samples === s.report.sampling[0].applied)).toBe(true)
    await s.replay()
    expect(s.report.replays.every(r => r.reproduced && r.restored)).toBe(true)
    expect(s.report.rows.every(r => r.checks.webgpu?.valid)).toBe(true)
  } finally { s.destroy() }
}, 120000)
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('4096 still uses exact production shaders in both GPUs at the inclusive cutoff', async () => {
  const s = await createMatchedSession({ ...base, count: 4096, ticks: 1 }, () => document.createElement('canvas'))
  try {
    expect(s.report.errors).toEqual({}); expect(s.report.method).toBe('exact')
    const row = await s.step()
    expect(row.complete).toBe(true)
    expect(Object.values(row.checks).every(c => c.valid && c.restored && c.stages.every(stage => stage.flagsExact))).toBe(true)
    for (const lane of s.lanes) await expect(lane.backend.readStructure()).rejects.toThrow('Exact repulsion')
  } finally { s.destroy() }
}, 120000)
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('rounds a fractional gravity origin as an f32 uniform before subtracting positions', async () => {
  const { graph, input } = createGraph({ count: 4, fixture: 'chain', decay: 100 })
  for (let i = 0; i < input.points.length; i += 4) input.points.set([2048, 2048, 0, 0], i)
  const settings = { ...forceSettings('varied32', 4), origin: [2048.0001, 2048.0001] as [number, number] }
  const expected = createOracle(graph, input, 'production', settings).stage('gravity', input.points, 1, 0)
  for (const kind of ['webgl', 'webgpu'] as const) {
    const canvas = document.createElement('canvas')
    const backend = kind === 'webgl'
      ? await createCombinedWebGL(canvas, graph, input, { forceSettings: settings })
      : await createCombinedWebGPU(canvas, graph, input, 'trig', { forceSettings: settings })
    try {
      backend.stepStage('gravity', 1)
      const actual = await backend.read()
      expect(actual.forces).toEqual(expected.forces); expect(actual.positions).toEqual(expected.positions)
    } finally { backend.destroy() }
  }
})
