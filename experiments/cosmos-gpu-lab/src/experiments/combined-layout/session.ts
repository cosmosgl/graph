import { compareArray, type Snapshot } from '../many-body/reference'
import { compareArray as springCompare } from '../weighted-links/reference'
import { frameFor, buildReference } from '../many-body-grid/data'
import { compareStructure } from '../many-body-grid/validation'
import { centroidReference, centroidRounding } from '../many-body-grid/centroids'
import { displacement } from '../repulsion-trajectories/metrics'
import { createGraph, cool, STAGES, type Stage, type Settings } from './data'
import { createOracle } from './reference'
import { metrics } from './metrics'
import { createCombinedWebGL } from './webgl'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'
export const BACKENDS = ['webgl', 'webgpu'] as const
export type Name = typeof BACKENDS[number]
export const LABELS = { webgl: 'Production WebGL', webgpu: 'WebGPU · streamed', CPU: 'CPU reference' }
export type StageCheck = {
  stage: Stage; forces: ReturnType<typeof springCompare>; positions: ReturnType<typeof springCompare>;
  structure?: ReturnType<typeof compareStructure>; centroidDifferences?: number; valid: boolean;
}
export type Result = {
  name: Name; stages: StageCheck[]; wholeTick: ReturnType<typeof compareArray>;
  metrics: ReturnType<typeof metrics>; drift: ReturnType<typeof displacement>; valid: boolean;
}
export type Row = { tick: number; alpha: number; nextAlpha: number; results: Result[]; cpu: ReturnType<typeof metrics>; complete: boolean }
type Failure = { tick: number; alpha: number; input: Float32Array; actual: Snapshot; expected: Snapshot }
type TickFailure = { tick: number; alpha: number; input: Float32Array; actual: Float32Array; expected: Float32Array }
export async function createCombinedSession (settings: Settings, canvas: (name: Name) => HTMLCanvasElement): Promise<{
  settings: Settings; graph: ReturnType<typeof createGraph>['graph']; lanes: Array<{ name: Name; backend: CombinedBackend; positions: Float32Array }>;
  rows: Row[]; errors: Partial<Record<Name, string>>; firstFailures: Record<string, Failure>;
  firstTickFailures: Record<string, TickFailure>; cpu(): Float32Array; alpha(): number; step(): Promise<Row>; probe(): Promise<Row>; destroy(): void;
}> {
  const { graph, input } = createGraph(settings); const oracle = createOracle(graph, input)
  let cpu = input.points; let alpha = 1; let destroyed = false; let busy = false
  const rows: Row[] = []; const errors: Partial<Record<Name, string>> = {}
  const firstFailures: Record<string, Failure> = {}
  const firstTickFailures: Record<string, TickFailure> = {}
  const lanes: Array<{ name: Name; backend: CombinedBackend; positions: Float32Array }> = []
  for (const name of BACKENDS) {
    try {
      const backend = await (name === 'webgl' ? createCombinedWebGL : createCombinedWebGPU)(canvas(name), graph, input)
      lanes.push({ name, backend, positions: input.points })
    } catch (error) { errors[name] = error instanceof Error ? error.message : String(error) }
  }
  const evaluate = async (value: number, probe: boolean): Promise<Row> => {
    if (busy || destroyed) throw new Error('Combined session unavailable or already stepping')
    busy = true
    const tick = rows.length; const cpuPrevious = cpu
    try {
      const cpuNext = oracle.tick(cpuPrevious, value, tick)
      const results: Result[] = []
      for (const lane of lanes) {
        if (destroyed) throw new Error('Combined session disposed')
        if (errors[lane.name]) continue
        const start = lane.positions; let previous = start
        const wholeExpected = oracle.tick(start, value, tick)
        const checks: StageCheck[] = []
        try {
          for (const stage of STAGES) {
            await new Promise(resolve => setTimeout(resolve, 0))
            if (destroyed) throw new Error('Combined session disposed')
            const expected = oracle.stage(stage, previous, value, tick)
            const frame = frameFor(previous, tick)
            if (stage === 'repulsion') lane.backend.setFrame(frame)
            lane.backend.stepStage(stage, value)
            const actual = await lane.backend.read()
            const compare = stage === 'incoming' || stage === 'outgoing' ? springCompare : compareArray
            const forces = compare(actual.forces, expected.forces); const positions = compare(actual.positions, expected.positions)
            const check: StageCheck = { stage, forces, positions, valid: forces.valid && positions.valid }
            if (stage === 'repulsion') {
              const structure = await lane.backend.readStructure()
              check.structure = compareStructure(structure, buildReference(previous, frame))
              if (lane.name === 'webgpu') {
                check.centroidDifferences = centroidRounding(await lane.backend.readCentroids!(), centroidReference(structure)).differingComponents
              }
              check.valid &&= check.structure.valid && !check.centroidDifferences
            }
            const key = `${probe ? 'probe-' : ''}${lane.name}-${stage}`
            if (!check.valid && !firstFailures[key]) firstFailures[key] = { tick: tick + 1, alpha: value, input: previous.slice(), actual, expected }
            checks.push(check); previous = actual.positions
          }
          const m = metrics(previous, start, graph)
          const wholeTick = compareArray(previous, wholeExpected)
          const key = `${probe ? 'probe-' : ''}${lane.name}`
          if (!wholeTick.valid && !firstTickFailures[key]) {
            firstTickFailures[key] = { tick: tick + 1, alpha: value, input: start.slice(), actual: previous, expected: wholeExpected }
          }
          results.push({
            name: lane.name,
            stages: checks,
            wholeTick,
            metrics: m,
            drift: displacement(previous, cpuNext),
            valid: checks.every(c => c.valid) && wholeTick.valid,
          })
          if (!probe) lane.positions = previous
          if (!m.shape.finite) errors[lane.name] = 'Non-finite present positions; path stopped'
        } catch (error) { errors[lane.name] = error instanceof Error ? error.message : String(error) } finally {
          if (probe && !destroyed) {
            try { lane.backend.setPositions(start) } catch (error) { errors[lane.name] = `Probe restore failed: ${String(error)}` }
          }
        }
      }
      if (destroyed) throw new Error('Combined session disposed')
      const row: Row = {
        tick: tick + 1,
        alpha: value,
        nextAlpha: probe ? alpha : cool(alpha, settings.decay),
        results,
        cpu: metrics(cpuNext, cpuPrevious, graph),
        complete: results.length === BACKENDS.length && !Object.keys(errors).length,
      }
      if (!probe) { cpu = cpuNext; alpha = row.nextAlpha; rows.push(row) }
      return row
    } finally { busy = false }
  }
  return {
    settings,
    graph,
    lanes,
    rows,
    errors,
    firstFailures,
    firstTickFailures,
    cpu: () => cpu,
    alpha: () => alpha,
    step: () => evaluate(alpha, false),
    probe: () => evaluate(1, true),
    destroy (): void { destroyed = true; lanes.forEach(lane => lane.backend.destroy()) },
  }
}
export type CombinedSession = Awaited<ReturnType<typeof createCombinedSession>>
