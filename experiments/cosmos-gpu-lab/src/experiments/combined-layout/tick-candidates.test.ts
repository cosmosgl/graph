import { expect, it } from 'vitest'
import { createCombinedSession } from './session'
const nativeTest = it.skipIf(!import.meta.env.LAB_NATIVE_GPU)
for (const precision of ['aligned', 'trig'] as const) {
  for (const fixture of ['chain', 'communities', 'star'] as const) {
    for (const decay of [100, 300]) {
      nativeTest(`${precision} ${fixture} / 2048 / ${decay} preserves stage, whole-tick and probe budgets`, async () => {
        const session = await createCombinedSession({ fixture, count: 2048, decay, checkpointEvery: 10, springPrecision: precision },
          () => document.createElement('canvas'))
        try {
          for (let i = 0; i < decay; i++) await session.step()
          const probe = await session.probe()
          expect(session.errors).toEqual({})
          expect(session.rows.every(r => r.complete)).toBe(true)
          expect(session.rows.filter(r => r.checked).flatMap(r => r.results.filter(c => c.name === 'webgpu' && !c.valid)
            .map(c => ({ tick: r.tick, stages: c.stages, whole: c.wholeTick })))).toEqual([])
          expect(probe.complete).toBe(true)
          expect(probe.results.find(r => r.name === 'webgpu')?.valid).toBe(true)
        } finally { session.destroy() }
      }, 180000)
    }
  }
}
