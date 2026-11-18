import { compareArray } from '../many-body/reference'
import { fitView } from '../many-body/backend'
import type { Measurement } from '../many-body/timing'
import { createBackend, replaceCanvas, type Api, type ClusterBackend } from './backend'
import { fixture, type Fixture, type ClusterInput } from './data'
import { compare, reference, type ClusterSnapshot } from './reference'
export const PLAN = {
  checkpoints: [1, 2, 10, 30],
  warmups: 2,
  samples: 7,
  operations: 16,
  cases: [{ kind: 'semantics' as Fixture, count: 8 }, ...[1024, 8192].flatMap(count =>
    (['balanced', 'uneven', 'single-group', 'targets'] as Fixture[]).map(kind => ({ kind, count })))],
}
export type CheckRow = { case: string; api: Api; tick: number | 'update'; checks: ReturnType<typeof compare>; trajectory: ReturnType<typeof compareArray>;
  failure?: { input: number[]; actual: ClusterSnapshot; expected: ClusterSnapshot }; }
export type Report = {
  recordedAt: string; status: 'running' | 'complete' | 'cancelled' | 'error'; plan: typeof PLAN; errors: string[];
  environment: Partial<Record<Api, ReturnType<ClusterBackend['environment']>>>; checks: CheckRow[];
  pairs: Array<{ case: string; tick: 1 | 'update'; checks: ReturnType<typeof compare> }>;
  postTiming: Array<{ case: string; api: Api; aggregate: ReturnType<typeof compareArray> }>;
  timings: Array<{ case: string; api: Api; warmup: boolean; sample: number; measurement: Measurement }>;
}
export function changedMembership (input: ClusterInput): ClusterInput {
  const groups = input.targets.length / 4
  const next = { ...input, membership: input.membership.slice(), strengths: input.strengths.slice(), targets: input.targets.slice() }
  next.membership.forEach((group, i) => { if (group >= 0) next.membership[i] = (group + 1) % groups })
  for (let i = 0; i < next.strengths.length; i++) next.strengths[i] = i % 3 ? 0.75 : 0
  for (let group = 0; group < groups; group++) next.targets.set([-24 + group, 12, 1, 0], group * 4)
  return next
}
export async function runStudy (
  canvases: Record<Api, HTMLCanvasElement>, progress: (text: string) => void, cancelled: () => boolean, report: Report
): Promise<void> {
  let hidden = document.visibilityState !== 'visible'
  const onVisibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
  document.addEventListener('visibilitychange', onVisibility)
  const visible = (): void => { if (hidden || document.visibilityState !== 'visible') throw new Error('Study interrupted: page was not continuously visible') }
  try {
    for (const entry of PLAN.cases) {
      if (cancelled()) { report.status = 'cancelled'; return }
      visible()
      const input = fixture(entry.kind, entry.count); const name = `${entry.kind}/${input.membership.length}`
      const backends: Partial<Record<Api, ClusterBackend>> = {}
      try {
        for (const api of ['webgl', 'webgpu'] as const) {
          progress(`${name}: preparing ${api}`)
          canvases[api] = replaceCanvas(canvases[api])
          backends[api] = await createBackend(api, canvases[api], input)
          report.environment[api] = backends[api].environment(); backends[api].render(fitView([input.points]))
          const info = report.environment[api]!.device
          if (info.fallback || info.gpu === 'software') throw new Error(`${api}: native adapter unavailable`)
        }
        let cpu: Float32Array = input.points.slice()
        for (let tick = 1; tick <= 30; tick++) {
          if (cancelled()) { report.status = 'cancelled'; return }
          const checkpoint = PLAN.checkpoints.includes(tick)
          const expectedCpu = reference(input, cpu); cpu = expectedCpu.positions
          const shared: Partial<Record<Api, ClusterSnapshot>> = {}
          for (const api of ['webgl', 'webgpu'] as const) {
            const b = backends[api]!
            const before = checkpoint ? tick === 1 ? input.points : (await b.read()).positions : undefined
            b.step()
            if (before) {
              const actual = await b.read(); const expected = reference(input, before)
              if (tick === 1) shared[api] = actual
              const checks = compare(actual, expected, before); const trajectory = compareArray(actual.positions, cpu, input.points)
              report.checks.push({
                case: name,
                api,
                tick,
                checks,
                trajectory,
                ...!checks.valid || !trajectory.valid ? { failure: { input: Array.from(before), actual, expected } } : {},
              })
            }
          }
          if (tick === 1) report.pairs.push({ case: name, tick: 1, checks: compare(shared.webgpu!, shared.webgl!, input.points) })
        }
        progress(`${name}: checking membership/target/strength update`)
        const updated = changedMembership(input); const expected = reference(updated)
        const sharedUpdate: Partial<Record<Api, ClusterSnapshot>> = {}
        for (const api of ['webgl', 'webgpu'] as const) {
          const b = backends[api]!
          b.updateClusters(updated); b.setPositions(updated.points); b.step()
          const actual = await b.read(); const checks = compare(actual, expected, updated.points)
          sharedUpdate[api] = actual
          report.checks.push({
            case: name,
            api,
            tick: 'update',
            checks,
            trajectory: compareArray(actual.positions, expected.positions, input.points),
            ...!checks.valid ? { failure: { input: Array.from(updated.points), actual, expected } } : {},
          })
          b.updateClusters(input); b.setPositions(input.points); b.render(fitView([input.points]))
        }
        report.pairs.push({ case: name, tick: 'update', checks: compare(sharedUpdate.webgpu!, sharedUpdate.webgl!, updated.points) })
        progress(`${name}: force-only GPU cost · 2 warmups + 7 samples, 16 frozen evaluations each`)
        // Alternate backend order. Uploads, rendering, readbacks and CPU checks are outside GPU intervals.
        for (let sample = -PLAN.warmups; sample < PLAN.samples; sample++) {
          for (const api of (sample % 2 ? ['webgpu', 'webgl'] : ['webgl', 'webgpu']) as Api[]) {
            if (cancelled()) { report.status = 'cancelled'; return }
            visible()
            const measurement = await backends[api]!.measureForce(PLAN.operations)
            visible(); report.timings.push({ case: name, api, sample, warmup: sample < 0, measurement })
          }
        }
        // A timed batch must still hold ONE group aggregate, not 16 accumulated copies.
        for (const api of ['webgl', 'webgpu'] as const) {
          const actual = await backends[api]!.read(); const sum = compareArray(actual.aggregates, reference(input).aggregates)
          report.postTiming.push({ case: name, api, aggregate: sum })
        }
      } finally { for (const backend of Object.values(backends)) backend.destroy() }
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.errors.push(String(error)) } finally { document.removeEventListener('visibilitychange', onVisibility) }
}
export function createReport (): Report {
  return { recordedAt: new Date().toISOString(), status: 'running', plan: PLAN, errors: [], environment: {}, checks: [], pairs: [], postTiming: [], timings: [] }
}
