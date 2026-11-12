import { TOLERANCE, compareArray } from '../many-body/reference'
import { TOLERANCE as springTolerance } from '../weighted-links/reference'
import { createOracle } from '../combined-layout/reference'
import { centerAggregate } from '../combined-layout/center-reference'
import type { CombinedBackend } from '../combined-layout/backend'
import { DEFAULT_CENTER_REDUCTION } from '../combined-layout/center-reduction'
import { collisionView } from './camera'
import { createFixture, overlap, type Settings } from './data'
import { createBackend, parametersFor, sequence, type Api } from './backend'
import { evaluate, expectedTick, sameBits, stageCheck, type Failure, type Gate } from './checks'
import type { CollisionCostReport } from './timing'
export type Row = { tick: number; checks: Partial<Record<Api, Gate>>; overlap: Record<string, ReturnType<typeof overlap>>;
  cross?: ReturnType<typeof compareArray>; complete: boolean; }
export async function createCollisionSession (settings: Settings, canvas: (api: Api) => HTMLCanvasElement): Promise<{
  settings: Settings; graph: ReturnType<typeof createFixture>['graph']; lanes: Array<{ api: Api; backend: CombinedBackend; positions: Float32Array }>;
  report: { schemaVersion: number; recordedAt: string; browser: string; settings: Settings;
    tolerance: typeof TOLERANCE; springTolerance: typeof springTolerance;
    rows: Row[]; errors: Partial<Record<Api, string>>; devices: Partial<Record<Api, string>>; input: ReturnType<typeof createFixture>;
    failures: Partial<Record<Api, { stage?: Failure; input: Float32Array; actual: Float32Array; expected: Float32Array }>>;
    replays: Array<{ api: Api; reproduced: boolean; restored: boolean }>; cost?: CollisionCostReport; };
  cpu(): Float32Array; step(): Promise<void>; replay(): Promise<void>; destroy(): void;
}> {
  const { input, graph } = createFixture(settings.fixture, settings.count)
  settings = {
    ...settings, count: graph.sizes.length, collision: { ...settings.collision }, centerReduction: settings.centerReduction ?? DEFAULT_CENTER_REDUCTION,
  }
  const parameters = parametersFor(settings); const stages = sequence(settings.mode, parameters)
  const oracle = createOracle(graph, input, 'production', parameters); let cpu: Float32Array = input.points.slice(); let destroyed = false
  const lanes: Array<{ api: Api; backend: CombinedBackend; positions: Float32Array }> = []
  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    settings,
    tolerance: TOLERANCE,
    springTolerance,
    rows: [] as Row[],
    errors: {} as Partial<Record<Api, string>>,
    devices: {} as Partial<Record<Api, string>>,
    input: { input, graph },
    failures: {} as Partial<Record<Api, { stage?: Failure; input: Float32Array; actual: Float32Array; expected: Float32Array }>>,
    replays: [] as Array<{ api: Api; reproduced: boolean; restored: boolean }>,
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
    async step (): Promise<void> {
      if (destroyed) throw new Error('Collision session disposed')
      const start = cpu; const checks: Row['checks'] = {}; const overlaps: Row['overlap'] = {}
      const expected = expectedTick(oracle, stages, start, settings.alpha)
      for (const lane of lanes) {
        if (report.errors[lane.api]) continue
        try {
          const result = await evaluate(lane.backend, oracle, stages, start, settings.alpha)
          if (destroyed) return
          checks[lane.api] = result.gate; lane.positions = result.actual.positions
          if (!result.gate.valid && !report.failures[lane.api]) {
            report.failures[lane.api] = {
              stage: result.failure, input: start.slice(), actual: result.actual.positions, expected: result.expected.positions,
            }
          }
          overlaps[lane.api] = overlap(lane.positions, graph.sizes, settings.collision)
        } catch (error) { report.errors[lane.api] = String(error) }
      }
      if (destroyed) return
      cpu = expected.positions; overlaps.cpu = overlap(cpu, graph.sizes, settings.collision)
      const cross = lanes.length === 2 && !Object.keys(report.errors).length ? compareArray(lanes[1].positions, lanes[0].positions, start) : undefined
      report.rows.push({
        tick: report.rows.length + 1,
        checks,
        overlap: overlaps,
        cross,
        complete: Object.keys(checks).length === 2 && !Object.keys(report.errors).length,
      })
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
            const failure = capture.stage; lane.backend.setPositions(failure.input); lane.backend.stepStage(failure.stage, settings.alpha)
            const actual = await lane.backend.read(); const check = stageCheck(failure.stage, actual, failure.expected, failure.input)
            if (failure.stage === 'center') {
              check.aggregate = compareArray(await lane.backend.readCenter!(), centerAggregate(failure.input)); check.valid &&= check.aggregate.valid
            }
            reproduced = sameBits(actual.positions, failure.actual.positions) && sameBits(actual.forces, failure.actual.forces) && !check.valid
          } else {
            const result = await evaluate(lane.backend, oracle, stages, capture.input, settings.alpha)
            reproduced = sameBits(result.actual.positions, capture.actual) && !result.gate.valid
          }
        } finally { lane.backend.setPositions(saved) }
        report.replays.push({ api: lane.api, reproduced, restored: sameBits((await lane.backend.read()).positions, saved) })
      }
    },
    destroy (): void { if (destroyed) return; destroyed = true; lanes.forEach(l => l.backend.destroy()) },
  }
}
export type CollisionSession = Awaited<ReturnType<typeof createCollisionSession>>
