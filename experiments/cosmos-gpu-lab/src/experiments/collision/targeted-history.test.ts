import { expect, it } from 'vitest'
import { COLLISION } from './data'
import { createCollisionSession } from './session'
for (const topology of ['chain', 'communities', 'star'] as const) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`targeted ${topology}: independently cooled dense layout retains the original trajectory gate`, async () => {
    const session = await createCollisionSession({
      fixture: 'clusters',
      count: 512,
      topology,
      mode: 'combined',
      evolution: 'independent',
      alpha: 1,
      coolingTicks: 100,
      arithmetic: 'targeted',
      centerReduction: 'high-low',
      collision: { ...COLLISION, iterations: 4 },
    }, () => document.createElement('canvas'))
    try {
      expect(session.report.errors).toEqual({})
      for (let i = 0; i < 100; i++) {
        await session.step(); const row = session.report.rows.at(-1)!
        expect(row.complete).toBe(true)
        expect(row.checks.webgpu!.valid, `${row.tick}: ${JSON.stringify(row.checks.webgpu)}`).toBe(true)
        expect(row.trajectory.webgpu!.valid, `${row.tick}: ${JSON.stringify(row.trajectory.webgpu)}`).toBe(true)
        expect(row.metrics.webgpu!.shape.finite).toBe(true)
      }
    } finally { session.destroy() }
  }, 120000)
}
