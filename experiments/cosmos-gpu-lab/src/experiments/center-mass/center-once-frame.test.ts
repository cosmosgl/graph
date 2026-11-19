import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { compareArray } from '../many-body/reference'
import { median, type Measurement } from '../many-body/timing'
import { sharedView } from '../matched-layout/metrics'
import { createGraph } from '../combined-layout/data'
import { forceSettings } from '../combined-layout/production-settings'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import type { CombinedBackend } from '../combined-layout/backend'

it.skipIf(!import.meta.env.LAB_CENTER_ONCE_FRAME)('measures paired complete frames with the center computed once', async () => {
  const report: {
    sourceRevision: string; sourceSnapshot: string; browser: string; visibility: string; luma: string;
    status: string; error: string; rows: unknown[];
  } = {
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    browser: navigator.userAgent,
    visibility: document.visibilityState,
    luma: '10.0.0-alpha.15',
    status: 'running',
    error: '',
    rows: [],
  }
  const policy = { warmups: 3, samples: 11, frames: 1 }
  try {
    if (!report.sourceRevision || !report.sourceSnapshot) throw new Error('Source snapshot and revision are required')
    if (report.visibility !== 'visible' || navigator.userAgent.includes('HeadlessChrome')) throw new Error('A visible browser is required')
    await writeArtifact('center-once-frame', report)
    const counts = import.meta.env.LAB_SCALE_COUNT ? [import.meta.env.LAB_SCALE_COUNT] : [8192, 16384]
    for (const count of counts) {
      const { graph, input } = createGraph({ count, fixture: 'communities', decay: 100 })
      for (let i = 0; i < input.points.length; i += 4) { input.points[i] += 2048; input.points[i + 1] -= 2048 }
      input.points[2] = 1; input.points.set([NaN, NaN, 0, 1], 4)
      const settings = { ...forceSettings('varied32', count), center: 1, origin: [2048, -2048] as [number, number] }
      const view = sharedView([input.points])
      const backends: CombinedBackend[] = []
      const pairs: Array<{
        round: number; warmup: boolean; perPoint: Measurement; once: Measurement;
        positions: ReturnType<typeof compareArray>; forces: ReturnType<typeof compareArray>; stateExact: boolean;
      }> = []
      try {
        for (const centerCalculation of ['per-point', 'once'] as const) {
          const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
          backends.push(await createCombinedWebGPU(canvas, graph, input, 'trig', {
            forceSettings: settings,
            repulsionPolicy: 'production',
            gpuBounds: true,
            gridAggregation: 'cached-small',
            springOptimization: 'prefetch',
            centerForceVariant: 'linear',
            centerCalculation,
          }))
        }
        const info = backends.map(backend => backend.positionSource!().device.info)
        if (info.some(value => value.fallback !== false)) throw new Error('Non-fallback WebGPU devices are required')
        for (let round = 0; round < policy.warmups + policy.samples; round++) {
          const results: Array<Awaited<ReturnType<NonNullable<CombinedBackend['measureFrozenFrames']>>> | undefined> = []
          for (const index of round % 2 ? [1, 0] : [0, 1]) {
            if (document.visibilityState !== 'visible') throw new Error('Keep the tab visible during measurement')
            backends[index].setPositions(input.points)
            results[index] = await backends[index].measureFrozenFrames!({ frames: policy.frames, alpha: 1, tick: 0, view })
            if (document.visibilityState !== 'visible') throw new Error('The tab was hidden during measurement')
          }
          const a = results[0]!; const b = results[1]!
          const stateExact = [a.snapshots[0].positions, b.snapshots[0].positions].every(points => {
            for (let i = 0; i < points.length; i += 4) {
              if (points[i + 2] !== input.points[i + 2] || points[i + 3] !== input.points[i + 3]) return false
              if ((input.points[i + 2] > 0.5 || input.points[i + 3] > 0.5) &&
                (!Object.is(points[i], input.points[i]) || !Object.is(points[i + 1], input.points[i + 1]))) return false
            }
            return true
          })
          pairs.push({
            round,
            warmup: round < policy.warmups,
            perPoint: a.timing,
            once: b.timing,
            positions: compareArray(b.snapshots[0].positions, a.snapshots[0].positions, input.points),
            forces: compareArray(b.snapshots[0].forces, a.snapshots[0].forces, input.points),
            stateExact,
          })
        }
        const valid = pairs.every(pair => pair.positions.valid && pair.forces.valid && pair.stateExact &&
          [pair.perPoint, pair.once].every(time => time.timerStatus === 'valid' && time.batchGpuMs !== null &&
            Number.isFinite(time.batchGpuMs) && time.batchGpuMs >= 0))
        const samples = pairs.filter(pair => !pair.warmup)
        const current = samples.map(pair => pair.perPoint.batchGpuMs!)
        const once = samples.map(pair => pair.once.batchGpuMs!)
        const delta = samples.map((pair, index) => once[index] - current[index])
        const summary = valid
          ? {
            perPointMs: median(current),
            onceMs: median(once),
            differenceMs: median(delta),
            differenceRange: [Math.min(...delta), Math.max(...delta)],
          }
          : null
        report.rows.push({ count, links: graph.links.length / 2, info, policy, view, pairs, summary })
        await writeArtifact('center-once-frame', report)
      } finally { backends.forEach(backend => backend.destroy()) }
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally { await writeArtifact('center-once-frame', report) }
  expect(report.error).toBe('')
  expect(report.status).toBe('complete')
}, 900000)
