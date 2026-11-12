import { TOLERANCE, compareArray } from '../many-body/reference'
import { TOLERANCE as springTolerance } from '../weighted-links/reference'
import { createOracle } from '../combined-layout/reference'
import { centerAggregate } from '../combined-layout/center-reference'
import type { CombinedBackend } from '../combined-layout/backend'
import { DEFAULT_CENTER_REDUCTION } from '../combined-layout/center-reduction'
import { cool } from '../combined-layout/data'
import { stressPairs } from '../matched-layout/metrics'
import { layoutMetrics } from './metrics'
import { collisionView } from './camera'
import { DEFAULT_COLLISION_ARITHMETIC, createFixture, overlap, type Settings } from './data'
import { createBackend, parametersFor, sequence, type Api } from './backend'
import { evaluate, expectedTick, sameBits, stageCheck, type Failure, type Gate } from './checks'
import type { CollisionCostReport } from './timing'
export type Row = { tick: number; alpha: number; checks: Partial<Record<Api, Gate>>; overlap: Record<string, ReturnType<typeof overlap>>;
  trajectory: Partial<Record<Api, ReturnType<typeof compareArray>>>; metrics: Partial<Record<Api | 'cpu', ReturnType<typeof layoutMetrics>>>;
  cross?: ReturnType<typeof compareArray>; complete: boolean; }
type TrajectoryFailure = { tick: number; alpha: number; input: Float32Array; actual: Float32Array; expected: Float32Array }
type TickFailure = { alpha: number; stage?: Failure; input: Float32Array; actual: Float32Array; expected: Float32Array }
export async function createCollisionSession (settings: Settings, canvas: (api: Api) => HTMLCanvasElement): Promise<{
  settings: Settings; graph: ReturnType<typeof createFixture>['graph']; lanes: Array<{ api: Api; backend: CombinedBackend; positions: Float32Array }>;
  report: { schemaVersion: number; recordedAt: string; browser: string; settings: Settings;
    tolerance: typeof TOLERANCE; springTolerance: typeof springTolerance;
    rows: Row[]; errors: Partial<Record<Api, string>>; devices: Partial<Record<Api, string>>; input: ReturnType<typeof createFixture>;
    failures: Partial<Record<Api, TickFailure>>;
    trajectoryFailures: Partial<Record<Api, TrajectoryFailure>>; stressSampling: { landmarks: number[]; pairs: number; unreachable: number };
    replays: Array<{ api: Api; kind?: 'tick' | 'trajectory'; reproduced: boolean; restored: boolean }>; cost?: CollisionCostReport; };
  cpu(): Float32Array; alpha(): number; step(): Promise<void>; replay(): Promise<void>; destroy(): void;
}> {
  const { input, graph } = createFixture(settings.fixture, settings.count, settings.topology)
  settings = {
    ...settings,
    count: graph.sizes.length,
    collision: { ...settings.collision },
    centerReduction: settings.centerReduction ?? DEFAULT_CENTER_REDUCTION,
    arithmetic: settings.arithmetic ?? DEFAULT_COLLISION_ARITHMETIC,
    evolution: settings.evolution ?? 'shared',
    topology: settings.topology ?? 'chain',
  }
  if (!['shared', 'independent'].includes(settings.evolution!)) throw new Error('Invalid collision evolution')
  if (settings.coolingTicks !== undefined && (!Number.isInteger(settings.coolingTicks) || settings.coolingTicks < 0 || settings.coolingTicks > 5000)) {
    throw new Error('Invalid collision cooling schedule')
  }
  const independent = settings.evolution === 'independent'
  const sampled = stressPairs(graph)
  const parameters = parametersFor(settings); const stages = sequence(settings.mode, parameters)
  const oracle = createOracle(graph, input, 'production', parameters); let cpu: Float32Array = input.points.slice(); let destroyed = false
  let alpha = settings.alpha
  const lanes: Array<{ api: Api; backend: CombinedBackend; positions: Float32Array }> = []
  const report = {
    schemaVersion: 2,
    recordedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    settings,
    tolerance: TOLERANCE,
    springTolerance,
    rows: [] as Row[],
    errors: {} as Partial<Record<Api, string>>,
    devices: {} as Partial<Record<Api, string>>,
    input: { input, graph },
    failures: {} as Partial<Record<Api, TickFailure>>,
    trajectoryFailures: {} as Partial<Record<Api, TrajectoryFailure>>,
    stressSampling: { landmarks: sampled.landmarks, pairs: sampled.pairs.length, unreachable: sampled.unreachable },
    replays: [] as Array<{ api: Api; kind?: 'tick' | 'trajectory'; reproduced: boolean; restored: boolean }>,
  }
  try {
    for (const api of ['webgl', 'webgpu'] as const) {
      try {
        const backend = await createBackend(api, canvas(api), graph, input, parameters)
        lanes.push({ api, backend, positions: input.points.slice() }); report.devices[api] = backend.info
      } catch (error) { report.errors[api] = String(error) }
    }
  } catch (error) { lanes.forEach(l => l.backend.destroy()); throw error }
  return {
    settings,
    graph,
    lanes,
    report,
    cpu: () => cpu,
    alpha: () => alpha,
    async step (): Promise<void> {
      if (destroyed) throw new Error('Collision session disposed')
      if (settings.coolingTicks && report.rows.length >= settings.coolingTicks) throw new Error('Cooling schedule finished; reset to run again')
      const start = cpu; const checks: Row['checks'] = {}; const overlaps: Row['overlap'] = {}
      const trajectory: Row['trajectory'] = {}; const metrics: Row['metrics'] = {}
      const expected = expectedTick(oracle, stages, start, alpha)
      for (const lane of lanes) {
        if (report.errors[lane.api]) continue
        try {
          const laneStart = independent ? lane.positions : start
          const result = await evaluate(lane.backend, oracle, stages, laneStart, alpha, !independent)
          if (destroyed) return
          checks[lane.api] = result.gate; lane.positions = result.actual.positions
          if (!result.gate.valid && !report.failures[lane.api]) {
            report.failures[lane.api] = {
              alpha, stage: result.failure, input: laneStart.slice(), actual: result.actual.positions, expected: result.expected.positions,
            }
          }
          overlaps[lane.api] = overlap(lane.positions, graph.sizes, settings.collision)
          trajectory[lane.api] = compareArray(lane.positions, expected.positions, start)
          metrics[lane.api] = layoutMetrics(lane.positions, laneStart, expected.positions, sampled.pairs)
          if (!trajectory[lane.api]!.valid && !report.trajectoryFailures[lane.api]) {
            report.trajectoryFailures[lane.api] = {
              tick: report.rows.length + 1, alpha, input: laneStart.slice(), actual: lane.positions.slice(), expected: expected.positions.slice(),
            }
          }
        } catch (error) { report.errors[lane.api] = String(error) }
      }
      if (destroyed) return
      cpu = expected.positions; overlaps.cpu = overlap(cpu, graph.sizes, settings.collision)
      metrics.cpu = layoutMetrics(cpu, start, cpu, sampled.pairs)
      const cross = lanes.length === 2 && !Object.keys(report.errors).length ? compareArray(lanes[1].positions, lanes[0].positions, start) : undefined
      report.rows.push({
        tick: report.rows.length + 1,
        alpha,
        checks,
        trajectory,
        metrics,
        overlap: overlaps,
        cross,
        complete: Object.keys(checks).length === 2 && !Object.keys(report.errors).length,
      })
      if (settings.coolingTicks) alpha = cool(alpha, settings.coolingTicks)
      const view = collisionView([cpu, ...lanes.map(l => l.positions)], graph.sizes, settings.collision)
      for (const lane of lanes) {
        if (!report.errors[lane.api]) {
          try { lane.backend.render(view) } catch (error) { report.errors[lane.api] = String(error); report.rows.at(-1)!.complete = false }
        }
      }
    },
    async replay (): Promise<void> {
      for (const lane of lanes) {
        const capture = report.failures[lane.api]; if (!capture || report.errors[lane.api]) continue
        const saved = lane.positions.slice(); let reproduced = false
        try {
          if (capture.stage) {
            const failure = capture.stage; lane.backend.setPositions(failure.input); lane.backend.stepStage(failure.stage, capture.alpha)
            const actual = await lane.backend.read(); const check = stageCheck(failure.stage, actual, failure.expected, failure.input)
            if (failure.stage === 'center') {
              check.aggregate = compareArray(await lane.backend.readCenter!(), centerAggregate(failure.input)); check.valid &&= check.aggregate.valid
            }
            reproduced = sameBits(actual.positions, failure.actual.positions) && sameBits(actual.forces, failure.actual.forces) && !check.valid
          } else {
            const result = await evaluate(lane.backend, oracle, stages, capture.input, capture.alpha)
            reproduced = sameBits(result.actual.positions, capture.actual) && !result.gate.valid
          }
        } finally { lane.backend.setPositions(saved) }
        report.replays.push({ api: lane.api, kind: 'tick', reproduced, restored: sameBits((await lane.backend.read()).positions, saved) })
      }
      for (const lane of lanes) {
        const capture = report.trajectoryFailures[lane.api]; if (!capture || report.errors[lane.api]) continue
        const saved = lane.positions.slice(); let reproduced = false
        try {
          const result = await evaluate(lane.backend, oracle, stages, capture.input, capture.alpha)
          // A trajectory replay uses its stored independent CPU output, not a
          // freshly evaluated CPU tick from the GPU's different starting state.
          reproduced = sameBits(result.actual.positions, capture.actual) &&
            !compareArray(result.actual.positions, capture.expected, capture.input).valid
        } finally { lane.backend.setPositions(saved) }
        report.replays.push({ api: lane.api, kind: 'trajectory', reproduced, restored: sameBits((await lane.backend.read()).positions, saved) })
      }
    },
    destroy (): void { if (destroyed) return; destroyed = true; lanes.forEach(l => l.backend.destroy()) },
  }
}
export type CollisionSession = Awaited<ReturnType<typeof createCollisionSession>>
