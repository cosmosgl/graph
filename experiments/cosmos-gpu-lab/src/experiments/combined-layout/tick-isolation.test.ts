import { expect, it } from 'vitest'
import { createCombinedSession } from './session'
import { benchmarkSprings, type SpringTimingRow } from './spring-benchmark'
import { isolateTickFailure } from './tick-isolation'
it.skipIf(!import.meta.env.LAB_NATIVE_GPU || Number(import.meta.env.LAB_SCALE_COUNT) !== 8192)(
  'isolates the 8192 star composed probe without changing the acceptance budget', async () => {
    const session = await createCombinedSession({ fixture: 'star', count: 8192, decay: 100, checkpointEvery: 10, springPrecision: 'products' },
      () => document.createElement('canvas'))
    try {
      for (let i = 0; i < 100; i++) await session.step()
      await session.probe()
      expect(session.errors).toEqual({})
      const saved = session.lanes.map(l => l.positions.slice()); const alpha = session.alpha()
      const report = await isolateTickFailure(session)
      // eslint-disable-next-line no-console
      console.info(`LAB_TICK_ISOLATION ${JSON.stringify(report)}`)
      expect(report.baselineMatchesCapture).toBe(true)
      expect(report.components.map(c => c.point)).toEqual([43, 4424])
      expect(report.ablations.find(r => r.name === 'original')?.positions.failures).toBe(2)
      expect(report.ablations.find(r => r.name === 'rounded gravity integration')?.positions.valid).toBe(false)
      expect(report.ablations.find(r => r.name === 'rounded repulsion integration')?.positions.valid).toBe(true)
      const rows: SpringTimingRow[] = []
      await benchmarkSprings({
        settings: session.settings,
        stages: ['gravity', 'repulsion'],
        modes: ['products', 'composed', 'aligned'],
        rows,
        cancelled: () => false,
        progress: () => {},
      })
      // eslint-disable-next-line no-console
      console.info(`LAB_TICK_TIMING ${JSON.stringify(rows)}`)
      expect(rows).toHaveLength(12)
      expect(rows.every(r => !r.error && r.summary?.gpuMs != null && r.checks.every(c => c.forces.valid && c.positions.valid))).toBe(true)
      expect(session.alpha()).toBe(alpha)
      expect(session.lanes.map(l => l.positions)).toEqual(saved)
    } finally { session.destroy() }
  }, 180000)
