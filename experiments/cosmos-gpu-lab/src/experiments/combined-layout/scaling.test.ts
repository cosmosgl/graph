import { expect, it } from 'vitest'
import { TOLERANCE } from '../many-body/reference'
import { createCombinedSession } from './session'
import { benchmarkSprings, type SpringTimingRow } from './spring-benchmark'
import type { Fixture } from './data'

// Explicit research run: native GPU only, one size at a time. Inspect 8192 before enabling 32768.
const count = Number(import.meta.env.LAB_SCALE_COUNT)
const scaleTest = it.skipIf(!import.meta.env.LAB_NATIVE_GPU || ![8192, 32768].includes(count))
const record = (event: string, value: unknown): void => {
  // eslint-disable-next-line no-console
  console.info(`LAB_SCALE_${event} ${JSON.stringify(value)}`)
}

// Always measure the serial star hub before starting longer trajectories at the requested size.
scaleTest(`spring GPU cost at ${count} points: star first, then chain and communities`, async () => {
  for (const fixture of ['star', 'chain', 'communities'] as const) {
    const rows: SpringTimingRow[] = []
    await benchmarkSprings({
      settings: { fixture, count, decay: 100 },
      modes: ['baseline', 'products'],
      rows,
      cancelled: () => false,
      progress: () => {},
    })
    record('TIMING', { fixture, count, browser: navigator.userAgent, rows })
    expect(rows).toHaveLength(8)
    expect(rows.every(r => !r.error && r.samples.length === 7 && r.summary?.gpuMs != null)).toBe(true)
    // The native baseline remains a diagnostic; only the corrected candidate is required to pass.
    const corrected = rows.filter(r => r.mode === 'products')
    const valid = corrected.every(r => r.checks.length === 10 && r.checks.every(c => c.forces.valid && c.positions.valid))
    expect(valid, JSON.stringify(corrected.map(r => ({ stage: r.stage, phase: r.phase, checks: r.checks })))).toBe(true)
  }
}, 180000)

for (const fixture of ['chain', 'communities', 'star'] as Fixture[]) {
  for (const decay of [100, 300]) {
    scaleTest(`products scaling: ${fixture} / ${count} / ${decay}`, async () => {
      const session = await createCombinedSession({ fixture, count, decay, checkpointEvery: 10, springPrecision: 'products' },
        () => document.createElement('canvas'))
      try {
        expect(session.errors).toEqual({})
        for (let tick = 0; tick < decay; tick++) {
          await session.step()
          if ((tick + 1) % 50 === 0) record('PROGRESS', { fixture, count, decay, tick: tick + 1 })
          if (Object.keys(session.errors).length) break
        }
        const probe = await session.probe()
        const replays = Object.keys(session.captures).length ? await session.replayFailures() : []
        record('TRAJECTORY', {
          settings: session.settings,
          browser: navigator.userAgent,
          devices: Object.fromEntries(session.lanes.map(l => [l.name, l.backend.info])),
          errors: session.errors,
          rows: session.rows,
          probe,
          replays,
          wholeTickFailures: Object.fromEntries(Object.entries(session.firstTickFailures).map(([key, f]) => [key, {
            tick: f.tick,
            components: Array.from(f.actual).flatMap((actual, i) => {
              const expected = f.expected[i]; const error = Math.abs(actual - expected)
              const budget = TOLERANCE.absolute + TOLERANCE.relative * Math.abs(expected)
              return error > budget ? [{ point: Math.floor(i / 4), axis: i % 4, actual, expected, error, budget }] : []
            }),
          }])),
          failures: Object.fromEntries(Object.entries(session.firstFailures).map(([key, f]) => [key, { tick: f.tick, alpha: f.alpha }])),
        })
        expect(session.errors).toEqual({})
        expect(session.rows).toHaveLength(decay)
        expect(session.rows.every(r => r.complete)).toBe(true)
        const failures = session.rows.filter(r => r.checked).flatMap(r => r.results.filter(c => c.name === 'webgpu' && !c.valid)
          .map(c => ({ tick: r.tick, stages: c.stages, whole: c.wholeTick })))
        expect(failures).toEqual([])
        expect(probe.complete).toBe(true)
        expect(probe.results.find(r => r.name === 'webgpu')?.valid).toBe(true)
        expect(replays.every(r => r.reproduced && r.restored)).toBe(true)
      } finally { session.destroy() }
    }, 600000)
  }
}
