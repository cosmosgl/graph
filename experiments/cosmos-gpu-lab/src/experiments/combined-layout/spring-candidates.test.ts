import { expect, it } from 'vitest'
import { compareArray } from '../weighted-links/reference'
import { createCombinedSession } from './session'
import { createCombinedWebGPU } from './webgpu'
import { createGraph } from './data'
import { createOracle } from './reference'
const nativeTest = it.skipIf(!import.meta.env.LAB_NATIVE_GPU)
for (const springPrecision of ['force', 'refined'] as const) {
  for (const fixture of ['star', 'communities'] as const) {
    for (const decay of [100, 300]) {
      nativeTest(`${springPrecision}: ${fixture} / 2048 / ${decay} preserves checkpoint and probe tolerance`, async () => {
        const s = await createCombinedSession({ fixture, count: 2048, decay, checkpointEvery: 10, springPrecision }, () => document.createElement('canvas'))
        try {
          for (let tick = 0; tick < decay; tick++) await s.step()
          const probe = await s.probe()
          expect(s.errors).toEqual({}); expect(probe.complete).toBe(true)
          expect(s.rows.every(r => r.complete)).toBe(true)
          const failed = s.rows.filter(r => r.checked).flatMap(r => r.results.filter(c => c.name === 'webgpu' && !c.valid)
            .map(c => ({ tick: r.tick, checks: c.stages, whole: c.wholeTick })))
          expect(failed).toEqual([])
          expect(probe.results.find(c => c.name === 'webgpu')?.valid).toBe(true)
        } finally { s.destroy() }
      }, 180000)
    }
  }
}
nativeTest('spring timing repeats a frozen stage and keeps its source positions unchanged', async () => {
  const { graph, input } = createGraph({ fixture: 'star', count: 512, decay: 100 })
  const oracle = createOracle(graph, input)
  const b = await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'refined')
  try {
    const expected = oracle.stage('incoming', input.points, 1, 1)
    for (const phase of ['force', 'step'] as const) {
      b.setPositions(input.points)
      const result = await b.measureSpring!('incoming', 1, phase, 3)
      expect(compareArray(result.snapshot.forces, expected.forces).valid).toBe(true)
      expect(compareArray(result.snapshot.positions, phase === 'force' ? input.points : expected.positions).valid).toBe(true)
      expect((await b.read()).positions).toEqual(input.points)
      expect(result.timing.operations).toBe(3)
      if (result.timing.timerStatus === 'valid') expect(result.timing.batchGpuMs).toBeGreaterThanOrEqual(0)
      else expect(result.timing.batchGpuMs).toBeNull()
    }
  } finally { b.destroy() }
})

// Negative control observed on M3: keep this failure visible, not inside the passing-candidate claim.
nativeTest('distance-only diagnostic retains the community cancellation failure at tick 10', async () => {
  const s = await createCombinedSession({
    fixture: 'communities',
    count: 2048,
    decay: 100,
    checkpointEvery: 10,
    springPrecision: 'distance',
  }, () => document.createElement('canvas'))
  try {
    for (let tick = 0; tick < 10; tick++) await s.step()
    expect(s.errors).toEqual({})
    const row = s.rows[9].results.find(r => r.name === 'webgpu')!
    expect(row.valid).toBe(false)
    expect(row.wholeTick?.valid).toBe(true)
    const stage = row.stages.find(r => r.stage === 'outgoing')!
    expect(stage.forces.valid).toBe(true)
    expect(stage.positions.failures).toBeGreaterThan(0)
    expect(s.firstFailures['webgpu-outgoing'].tick).toBe(10)
  } finally { s.destroy() }
})
