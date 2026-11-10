import { compareArray, type Snapshot } from '../many-body/reference'
import { compareArray as springCompare } from '../weighted-links/reference'
import { frameFor, buildReference } from '../many-body-grid/data'
import { compareStructure } from '../many-body-grid/validation'
import { centroidReference, centroidRounding } from '../many-body-grid/centroids'
import { displacement } from '../repulsion-trajectories/metrics'
import { createGraph, cool, isCheckpoint, STAGES, type Stage, type Settings } from './data'
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
type Checks = { stages: StageCheck[]; wholeTick?: ReturnType<typeof compareArray>; valid?: boolean }
export type Result = Checks & {
  name: Name; metrics: ReturnType<typeof metrics>; drift: ReturnType<typeof displacement>;
}
export type Row = {
  tick: number; alpha: number; nextAlpha: number; checked: boolean; results: Result[]; cpu: ReturnType<typeof metrics>; complete: boolean;
}
type Failure = { tick: number; alpha: number; input: Float32Array; actual: Snapshot; expected: Snapshot }
type TickFailure = { tick: number; alpha: number; input: Float32Array; actual: Float32Array; expected: Float32Array }
type Capture = { name: Name; tick: number; alpha: number; input: Float32Array; actual: Float32Array; checks: Checks }
export type Replay = {
  key: string; tick: number; name: Name; reproduced: boolean; restored: boolean; checks?: Checks;
  differingComponents?: number; sameChecks?: boolean; error?: string;
}
type Lane = { name: Name; backend: CombinedBackend; positions: Float32Array }
export async function createCombinedSession (settings: Settings, canvas: (name: Name) => HTMLCanvasElement): Promise<{
  settings: Settings; graph: ReturnType<typeof createGraph>['graph']; lanes: Lane[];
  rows: Row[]; errors: Partial<Record<Name, string>>; firstFailures: Record<string, Failure>;
  firstTickFailures: Record<string, TickFailure>; captures: Record<string, Capture>; replays: Replay[];
  cpu(): Float32Array; alpha(): number; step(forceCheck?: boolean): Promise<Row>; probe(): Promise<Row>; replayFailures(): Promise<Replay[]>; destroy(): void;
}> {
  const { graph, input } = createGraph(settings); const oracle = createOracle(graph, input)
  let cpu = input.points; let alpha = 1; let destroyed = false; let busy = false
  const rows: Row[] = []; const errors: Partial<Record<Name, string>> = {}
  const firstFailures: Record<string, Failure> = {}; const firstTickFailures: Record<string, TickFailure> = {}
  const captures: Record<string, Capture> = {}; const replays: Replay[] = []; const lanes: Lane[] = []
  for (const name of BACKENDS) {
    try {
      const backend = await (name === 'webgl' ? createCombinedWebGL : createCombinedWebGPU)(canvas(name), graph, input)
      lanes.push({ name, backend, positions: input.points })
    } catch (error) { errors[name] = error instanceof Error ? error.message : String(error) }
  }
  const execute = async (
    lane: Lane, start: Float32Array, value: number, tick: number, checked: boolean, capturePrefix?: string
  ): Promise<{ positions: Float32Array; checks: Checks }> => {
    let previous = start
    const wholeExpected = checked ? oracle.tick(start, value, tick) : undefined
    const stages: StageCheck[] = []
    for (const stage of STAGES) {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (destroyed) throw new Error('Combined session disposed')
      const expected = checked ? oracle.stage(stage, previous, value, tick) : undefined
      const frame = stage === 'repulsion' ? frameFor(previous, tick) : undefined
      if (frame) lane.backend.setFrame(frame)
      lane.backend.stepStage(stage, value)
      // Bounds need post-gravity positions; metrics need the final positions.
      // Intermediate spring/repulsion state stays resident on unchecked ticks.
      if (!checked && stage !== 'gravity' && stage !== 'outgoing') continue
      const actual = await lane.backend.read()
      if (expected) {
        const compare = stage === 'incoming' || stage === 'outgoing' ? springCompare : compareArray
        const forces = compare(actual.forces, expected.forces); const positions = compare(actual.positions, expected.positions)
        const check: StageCheck = { stage, forces, positions, valid: forces.valid && positions.valid }
        if (frame) {
          const structure = await lane.backend.readStructure()
          check.structure = compareStructure(structure, buildReference(previous, frame))
          if (lane.name === 'webgpu') {
            check.centroidDifferences = centroidRounding(await lane.backend.readCentroids!(), centroidReference(structure)).differingComponents
          }
          check.valid &&= check.structure.valid && !check.centroidDifferences
        }
        const key = `${capturePrefix}${lane.name}-${stage}`
        if (capturePrefix !== undefined && !check.valid && !firstFailures[key]) {
          firstFailures[key] = { tick: tick + 1, alpha: value, input: previous.slice(), actual, expected }
        }
        stages.push(check)
      }
      previous = actual.positions
    }
    const checks: Checks = { stages }
    if (wholeExpected) {
      checks.wholeTick = compareArray(previous, wholeExpected)
      checks.valid = stages.every(c => c.valid) && checks.wholeTick.valid
      const key = `${capturePrefix}${lane.name}`
      if (capturePrefix !== undefined) {
        if (!checks.wholeTick.valid && !firstTickFailures[key]) {
          firstTickFailures[key] = { tick: tick + 1, alpha: value, input: start.slice(), actual: previous, expected: wholeExpected }
        }
        if (!checks.valid && !captures[key]) {
          captures[key] = { name: lane.name, tick: tick + 1, alpha: value, input: start.slice(), actual: previous.slice(), checks }
        }
      }
    }
    return { positions: previous, checks }
  }
  const restore = (lane: Lane, positions: Float32Array): void => {
    if (destroyed) throw new Error('Combined session disposed')
    try { lane.backend.setPositions(positions) } catch (error) {
      errors[lane.name] = `Position restore failed: ${String(error)}`; throw error
    }
  }
  const evaluate = async (value: number, probe: boolean, forceCheck = false): Promise<Row> => {
    if (busy || destroyed) throw new Error('Combined session unavailable or already stepping')
    busy = true
    const tick = rows.length; const cpuPrevious = cpu; const checked = probe || forceCheck || isCheckpoint(tick + 1, settings)
    try {
      // Keep an independent CPU trajectory on every tick, not a reset at checkpoints.
      const cpuNext = oracle.tick(cpuPrevious, value, tick)
      const results: Result[] = []
      for (const lane of lanes) {
        if (destroyed) throw new Error('Combined session disposed')
        if (errors[lane.name]) continue
        const start = lane.positions
        try {
          const { positions, checks } = await execute(lane, start, value, tick, checked, probe ? 'probe-' : '')
          const m = metrics(positions, start, graph)
          results.push({ name: lane.name, ...checks, metrics: m, drift: displacement(positions, cpuNext) })
          if (!probe) lane.positions = positions
          if (!m.shape.finite) errors[lane.name] = 'Non-finite present positions; path stopped'
        } catch (error) { errors[lane.name] = error instanceof Error ? error.message : String(error) } finally {
          if (probe && !destroyed) { try { restore(lane, start) } catch { /* Restore records the backend error. */ } }
        }
      }
      if (destroyed) throw new Error('Combined session disposed')
      const row: Row = {
        tick: tick + 1,
        alpha: value,
        nextAlpha: probe ? alpha : cool(alpha, settings.decay),
        checked,
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
    captures,
    replays,
    cpu: () => cpu,
    alpha: () => alpha,
    step: (forceCheck = false) => evaluate(alpha, false, forceCheck),
    probe: () => evaluate(1, true),
    async replayFailures (): Promise<Replay[]> {
      if (busy || destroyed) throw new Error('Combined session unavailable or already stepping')
      busy = true; const reports: Replay[] = []
      try {
        for (const [key, capture] of Object.entries(captures)) {
          const report: Replay = { key, tick: capture.tick, name: capture.name, reproduced: false, restored: false }
          reports.push(report)
          const lane = lanes.find(l => l.name === capture.name)
          if (!lane || errors[capture.name]) { report.error = errors[capture.name] ?? 'Backend unavailable'; continue }
          const saved = lane.positions.slice()
          try {
            lane.backend.setPositions(capture.input)
            const replay = await execute(lane, capture.input, capture.alpha, capture.tick - 1, true)
            report.checks = replay.checks
            report.sameChecks = JSON.stringify(replay.checks) === JSON.stringify(capture.checks)
            const bits = (a: Float32Array): Uint32Array => new Uint32Array(a.buffer, a.byteOffset, a.length)
            const a = bits(replay.positions); const b = bits(capture.actual)
            report.differingComponents = a.reduce((sum, v, i) => sum + Number(v !== b[i]), 0)
            report.reproduced = replay.checks.valid === false && report.sameChecks && report.differingComponents === 0
          } catch (error) { report.error = String(error) } finally {
            try { restore(lane, saved); report.restored = true } catch (error) { report.error = String(error) }
          }
        }
        replays.push(...reports); return reports
      } finally { busy = false }
    },
    destroy (): void { destroyed = true; lanes.forEach(lane => lane.backend.destroy()) },
  }
}
export type CombinedSession = Awaited<ReturnType<typeof createCombinedSession>>
