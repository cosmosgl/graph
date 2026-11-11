import { expect, it } from 'vitest'
import { compareArray } from '../weighted-links/reference'
import { createCombinedSession } from './session'
import { isolateSpringFailure } from './spring-isolation'
import { createCombinedWebGPU } from './webgpu'
import { createGraph } from './data'
import { createOracle } from './reference'
const nativeTest = it.skipIf(!import.meta.env.LAB_NATIVE_GPU)

nativeTest('isolates the unchanged distance failure and compares uninstrumented product corrections', async () => {
  const s = await createCombinedSession({ fixture: 'communities', count: 2048, decay: 100, checkpointEvery: 10, springPrecision: 'distance' },
    () => document.createElement('canvas'))
  try {
    for (let i = 0; i < 10; i++) await s.step()
    const report = await isolateSpringFailure(s)
    expect(report.point).toBe(2031)
    expect(report.baselineMatchesCapture).toBe(true)
    expect(report.actualTrace.every(Number.isFinite)).toBe(true)
    expect(report.rows.map(r => [r.correction, r.forces.failures, r.positions.failures])).toEqual([
      ['none', 0, 1], ['scale', 0, 0], ['accumulation', 0, 1], ['products', 0, 0],
    ])
    expect(report.rows.at(-1)?.matchesReferenceBits).toBe(true)
    expect(s.rows).toHaveLength(10)
  } finally { s.destroy() }
})

for (const fixture of ['chain', 'star', 'communities'] as const) {
  for (const count of [512, 2048]) {
    for (const decay of [100, 300]) {
      nativeTest(`products: ${fixture} / ${count} / ${decay} preserves checkpoints and full-strength probe`, async () => {
        const s = await createCombinedSession({ fixture, count, decay, checkpointEvery: 10, springPrecision: 'products' },
          () => document.createElement('canvas'))
        try {
          for (let i = 0; i < decay; i++) await s.step()
          const probe = await s.probe()
          expect(s.errors).toEqual({})
          expect(s.rows.every(r => r.complete)).toBe(true)
          expect(s.rows.filter(r => r.checked).flatMap(r => r.results.filter(c => c.name === 'webgpu' && !c.valid)
            .map(c => ({ tick: r.tick, stages: c.stages, whole: c.wholeTick })))).toEqual([])
          expect(probe.complete).toBe(true)
          expect(probe.results.find(r => r.name === 'webgpu')?.valid).toBe(true)
        } finally { s.destroy() }
      }, 180000)
    }
  }
}

nativeTest('product correction passes the frozen CPU community inputs that defeated distance-only timing', async () => {
  const { graph, input } = createGraph({ fixture: 'communities', count: 2048, decay: 100 })
  const oracle = createOracle(graph, input)
  const b = await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'products')
  try {
    let positions = input.points
    for (const stage of ['gravity', 'repulsion', 'incoming', 'outgoing'] as const) {
      const expected = oracle.stage(stage, positions, 1, 1)
      if (stage === 'incoming' || stage === 'outgoing') {
        b.setPositions(positions)
        const result = await b.measureSpring!(stage, 1, 'step', 4)
        expect(compareArray(result.snapshot.forces, expected.forces).valid).toBe(true)
        expect(compareArray(result.snapshot.positions, expected.positions).valid).toBe(true)
      }
      positions = expected.positions
    }
  } finally { b.destroy() }
})
