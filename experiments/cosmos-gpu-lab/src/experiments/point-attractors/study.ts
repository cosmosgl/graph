import { compareArray, type Snapshot } from '../many-body/reference'
import { sharedView } from '../matched-layout/metrics'
import type { Measurement } from '../many-body/timing'
import { replaceCanvas } from '../../gpu/force-preview'
import { createBackend, type Api, type AttractorBackend } from './backend'
import { fixture, changedTargets, type Fixture, type AttractorInput } from './data'
import { compare, reference } from './reference'
export const PLAN = {
  checkpoints: [1, 2, 10, 30],
  updates: ['live-update', 'disable', 'reenable', 'frozen-update'] as const,
  warmups: 2,
  samples: 7,
  operations: 16,
  cases: [{ kind: 'semantics' as Fixture, count: 12 }, ...[1024, 8192].flatMap(count =>
    (['shared-target', 'individual-targets', 'mixed', 'translated'] as Fixture[]).map(kind => ({ kind, count })))],
}
export type CheckRow = {
  case: string; api: Api; tick: number | typeof PLAN.updates[number]; checks: ReturnType<typeof compare>;
  trajectory: ReturnType<typeof compareArray>; skippedUnchanged: boolean | null;
  failure?: { input: Float32Array; actual: Snapshot; expected: Snapshot };
}
export function rowAccepted (row: CheckRow): boolean { return row.checks.valid && row.trajectory.valid && row.skippedUnchanged !== false }
export type Report = {
  recordedAt: string; status: 'running' | 'complete' | 'cancelled' | 'error'; plan: typeof PLAN; errors: string[];
  environment: Partial<Record<Api, ReturnType<AttractorBackend['environment']>>>; checks: CheckRow[];
  pairs: Array<{ case: string; tick: 1 | 'frozen-update'; checks: ReturnType<typeof compare> }>;
  postTiming: Array<{ case: string; api: Api; checks: ReturnType<typeof compare> }>;
  timings: Array<{ case: string; api: Api; warmup: boolean; sample: number; measurement: Measurement }>;
}
export async function runStudy (
  canvases: Record<Api, HTMLCanvasElement>, progress: (text: string) => void, cancelled: () => boolean, report: Report
): Promise<void> {
  let hidden = document.visibilityState !== 'visible'
  const onVisibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
  document.addEventListener('visibilitychange', onVisibility)
  const visible = (): void => { if (hidden || document.visibilityState !== 'visible') throw new Error('Study interrupted: page was not continuously visible') }
  const stopped = (): boolean => { if (cancelled()) { report.status = 'cancelled'; return true } return false }
  try {
    for (const entry of PLAN.cases) {
      if (stopped()) return
      visible()
      const input = fixture(entry.kind, entry.count); const name = `${entry.kind}/${input.points.length / 4}`
      const backends: Partial<Record<Api, AttractorBackend>> = {}
      try {
        for (const api of ['webgl', 'webgpu'] as const) {
          progress(`${name}: preparing ${api}`)
          canvases[api] = replaceCanvas(canvases[api])
          backends[api] = await createBackend(api, canvases[api], input)
          report.environment[api] = backends[api].environment(); backends[api].render(sharedView([input.points]))
          const info = report.environment[api]!.device
          if (info.fallback || info.gpu === 'software') throw new Error(`${api}: native adapter unavailable`)
        }
        let cpu: Float32Array = input.points.slice()
        const record = (api: Api, tick: CheckRow['tick'], current: AttractorInput, before: Float32Array, actual: Snapshot): void => {
          const expected = reference(current, before)
          const row: CheckRow = {
            case: name,
            api,
            tick,
            checks: compare(actual, expected, before),
            trajectory: compareArray(actual.positions, cpu, input.points),
            skippedUnchanged: tick === 'disable' ? actual.positions.every((v, i) => Object.is(v, before[i])) : null,
          }
          if (!rowAccepted(row)) row.failure = { input: before, actual, expected }
          report.checks.push(row)
        }
        for (let tick = 1; tick <= 30; tick++) {
          if (stopped()) return
          const checkpoint = PLAN.checkpoints.includes(tick)
          cpu = reference(input, cpu).positions
          const shared: Partial<Record<Api, Snapshot>> = {}
          for (const api of ['webgl', 'webgpu'] as const) {
            const b = backends[api]!
            const before = checkpoint ? tick === 1 ? input.points : (await b.read()).positions : undefined
            b.step()
            if (before) {
              const actual = await b.read()
              if (tick === 1) shared[api] = actual
              record(api, tick, input, before, actual)
            }
          }
          if (tick === 1) report.pairs.push({ case: name, tick: 1, checks: compare(shared.webgpu!, shared.webgl!, input.points) })
        }
        const updated = changedTargets(input)
        for (const tick of PLAN.updates) {
          if (stopped()) return
          progress(`${name}: ${tick}`)
          const current = tick === 'disable' ? { ...updated, targets: undefined } : updated
          if (tick === 'frozen-update') cpu = input.points.slice()
          cpu = reference(current, cpu).positions
          const shared: Partial<Record<Api, Snapshot>> = {}
          for (const api of ['webgl', 'webgpu'] as const) {
            const b = backends[api]!
            if (tick === 'frozen-update') b.setPositions(input.points)
            const before = (await b.read()).positions
            b.updateAttractors(current); b.step()
            const actual = await b.read(); record(api, tick, current, before, actual); shared[api] = actual
          }
          if (tick === 'frozen-update') report.pairs.push({ case: name, tick, checks: compare(shared.webgpu!, shared.webgl!, input.points) })
        }
        for (const b of Object.values(backends)) { b.updateAttractors(input); b.setPositions(input.points); b.render(sharedView([input.points])) }
        progress(`${name}: force-only GPU cost · 2 warmups + 7 samples, 16 frozen evaluations each`)
        // No input uploads, integration, drawing, CPU validation or readbacks inside GPU intervals.
        for (let sample = -PLAN.warmups; sample < PLAN.samples; sample++) {
          for (const api of (sample % 2 ? ['webgpu', 'webgl'] : ['webgl', 'webgpu']) as Api[]) {
            if (stopped()) return
            visible()
            const measurement = await backends[api]!.measureForce(PLAN.operations)
            visible(); report.timings.push({ case: name, api, sample, warmup: sample < 0, measurement })
          }
        }
        for (const api of ['webgl', 'webgpu'] as const) {
          const actual = await backends[api]!.read()
          report.postTiming.push({ case: name, api, checks: compare(actual, { ...reference(input), positions: input.points }, input.points) })
        }
      } finally { for (const backend of Object.values(backends)) backend.destroy() }
    }
    visible(); report.status = 'complete'
  } catch (error) { report.status = 'error'; report.errors.push(String(error)) } finally { document.removeEventListener('visibilitychange', onVisibility) }
}
export function createReport (): Report {
  return { recordedAt: new Date().toISOString(), status: 'running', plan: PLAN, errors: [], environment: {}, checks: [], pairs: [], postTiming: [], timings: [] }
}
