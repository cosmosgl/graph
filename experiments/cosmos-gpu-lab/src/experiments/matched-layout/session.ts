import { createFixture } from '../many-body/data'
import { compareArray, TOLERANCE as repulsionTolerance } from '../many-body/reference'
import { compareArray as springCompare, TOLERANCE as springTolerance } from '../weighted-links/reference'
import { buildReference, frameFor, layout } from '../many-body-grid/data'
import { createGraph, cool, GRAVITY, REPULSION, SPRINGS, stagesFor, type Stage } from '../combined-layout/data'
import { centerAggregate } from '../combined-layout/center-reference'
import { DEFAULT_CENTER_REDUCTION } from '../combined-layout/center-reduction'
import { createOracle } from '../combined-layout/reference'
import { createCombinedWebGL } from '../combined-layout/webgl'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import { createSamplingPolicy, forceSettings, type ProductionPreset } from '../combined-layout/production-settings'
import { repulsionMethod } from '../combined-layout/repulsion-policy'
import type { CombinedBackend } from '../combined-layout/backend'
import type { CenterCostReport } from '../combined-layout/center-cost'
import { quality, stressPairs } from './metrics'
export const NAMES = ['webgl', 'webgpu', 'cpu'] as const
export type Name = typeof NAMES[number]
type GpuName = Exclude<Name, 'cpu'>
export const LABELS: Record<Name, string> = { webgl: 'Production GLSL · WebGL', webgpu: 'luma WebGPU', cpu: 'CPU reference' }
export type Settings = {
  count: number; fixture: 'chain' | 'communities' | 'star'; distribution: 'uniform' | 'clusters';
  ticks: number; checkpointEvery: number; preset: ProductionPreset; pinned: boolean; center?: number;
}
export type StageCheck = {
  stage: Stage; forces: ReturnType<typeof springCompare>; positions: ReturnType<typeof springCompare>; flagsExact: boolean;
  aggregate?: ReturnType<typeof compareArray>;
}
export type Check = { stages: StageCheck[]; wholeTick: ReturnType<typeof compareArray>; valid: boolean; restored: boolean }
type Quality = ReturnType<typeof quality>
export type Row = {
  tick: number; alpha: number; samples: number; quality: Partial<Record<Name, Quality>>;
  checks: Partial<Record<GpuName, Check>>; complete: boolean;
}
type Capture = { tick: number; alpha: number; samples: number; input: Float32Array; output: Float32Array; check: Check }
type Lane = { name: GpuName; backend: CombinedBackend; positions: Float32Array }
export async function createMatchedSession (settings: Settings, canvas: (name: GpuName) => HTMLCanvasElement): Promise<{
  settings: Settings; graph: ReturnType<typeof createGraph>['graph']; lanes: Lane[];
  report: {
    schemaVersion: number; experiment: string; recordedAt: string; browser: string; settings: Settings;
    parameters: ReturnType<typeof forceSettings>; method: string;
    tolerances: { repulsionTolerance: typeof repulsionTolerance; springTolerance: typeof springTolerance };
    physics: { gravity: number; repulsion: typeof REPULSION; springs: typeof SPRINGS }; policy: string;
    devices: Partial<Record<GpuName, string>>; stressSampling: { landmarks: number[]; pairs: number; unreachable: number };
    rows: Row[]; probe?: Row; captures: Partial<Record<GpuName, Capture>>;
    centerCost?: CenterCostReport;
    sampling: Array<{ tick: number; wanted: number; applied: number; changed: boolean }>;
    replays: Array<{ name: GpuName; reproduced: boolean; restored: boolean }>; errors: Partial<Record<GpuName, string>>;
  };
  cpu(): Float32Array; alpha(): number; step(forceCheck?: boolean): Promise<Row>; probe(): Promise<Row>; replay(): Promise<void>; destroy(): void;
}> {
  if (!['chain', 'communities', 'star'].includes(settings.fixture) || !['uniform', 'clusters'].includes(settings.distribution) ||
    !Number.isInteger(settings.count) || settings.count > 8192 || !Number.isInteger(settings.checkpointEvery) || settings.checkpointEvery < 1 ||
    !Number.isInteger(settings.ticks) || settings.ticks < 1 || settings.ticks > 5000) throw new Error('Invalid matched-layout settings')
  const { graph, input } = createGraph({ count: settings.count, fixture: settings.fixture, decay: settings.ticks })
  input.points = createFixture(settings.distribution, settings.count).points
  if (settings.pinned) input.points[2] = 1
  // Store's default spaceSize is 4096, and worldOrigin is [2048, 2048].
  for (let i = 0; i < input.points.length; i += 4) {
    input.points[i] = Math.fround(input.points[i] + 2048); input.points[i + 1] = Math.fround(input.points[i + 1] + 2048)
  }
  graph.points = input.points
  const parameters = {
    ...forceSettings(settings.preset, settings.count),
    origin: [2048, 2048] as [number, number],
    center: settings.center ?? 0,
    centerReduction: DEFAULT_CENTER_REDUCTION,
  }
  const oracle = createOracle(graph, input, 'production', parameters); const sampler = createSamplingPolicy(settings.count)
  const method = repulsionMethod(settings.count, 'production'); const sampled = stressPairs(graph)
  const report = {
    schemaVersion: 2,
    experiment: 'matched-layout',
    recordedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    settings: { ...settings },
    parameters: { ...parameters },
    physics: { gravity: GRAVITY, repulsion: REPULSION, springs: { ...SPRINGS, variation: parameters.variation } },
    policy: settings.preset === 'adaptive' && method === 'hierarchical'
      ? 'CPU pre-repulsion occupancy before ticks 1, 31, 61, …; one shared decision tape; per-lane bounds'
      : 'Fixed sample count; per-lane bounds; sample count unused on the exact route',
    method,
    tolerances: { repulsionTolerance, springTolerance },
    devices: {} as Partial<Record<GpuName, string>>,
    stressSampling: { landmarks: sampled.landmarks, pairs: sampled.pairs.length, unreachable: sampled.unreachable },
    rows: [] as Row[],
    probe: undefined as Row | undefined,
    captures: {} as Partial<Record<GpuName, Capture>>,
    sampling: [] as Array<{ tick: number; wanted: number; applied: number; changed: boolean }>,
    replays: [] as Array<{ name: GpuName; reproduced: boolean; restored: boolean }>,
    errors: {} as Partial<Record<GpuName, string>>,
  }
  const lanes: Lane[] = []; let cpu: Float32Array = input.points.slice(); let alpha = 1; let busy = false; let destroyed = false
  for (const name of ['webgl', 'webgpu'] as const) {
    try {
      const backend = name === 'webgl'
        ? await createCombinedWebGL(canvas(name), graph, input, {
          forceSettings: parameters, repulsionPolicy: 'production', adaptiveSampling: settings.preset === 'adaptive',
        })
        : await createCombinedWebGPU(canvas(name), graph, input, 'trig', {
          forceSettings: parameters,
          repulsionPolicy: 'production',
          adaptiveSampling: settings.preset === 'adaptive',
          springOptimization: 'prefetch',
          hubThreshold: 1024,
          gridAggregation: 'cached-small',
        })
      lanes.push({ name, backend, positions: input.points.slice() }); report.devices[name] = backend.info
    } catch (error) { report.errors[name] = String(error) }
  }
  const execute = async (lane: Lane, start: Float32Array, value: number, tick: number, checked: boolean): Promise<{
    positions: Float32Array; check?: Check;
  }> => {
    let previous = start; const stages: StageCheck[] = []
    const whole = checked ? oracle.tick(start, value, tick) : undefined
    for (const stage of stagesFor(parameters.center)) {
      if (destroyed) throw new Error('Matched session disposed')
      if (stage === 'repulsion' && method === 'hierarchical') lane.backend.setFrame(frameFor(previous, tick, parameters.samples, parameters.precise))
      const expected = checked ? oracle.stage(stage, previous, value, tick) : undefined
      lane.backend.stepStage(stage, value)
      if (!checked && stage !== 'gravity' && stage !== 'center' && stage !== 'outgoing') continue
      const actual = await lane.backend.read()
      if (expected) {
        const compare = stage === 'incoming' || stage === 'outgoing' ? springCompare : compareArray
        const check: StageCheck = {
          stage,
          forces: compare(actual.forces, expected.forces),
          positions: compare(actual.positions, expected.positions),
          flagsExact: actual.positions.every((v, i) => i % 4 < 2 || v === expected.positions[i]) &&
            actual.forces.every((v, i) => i % 4 < 2 || v === expected.forces[i]),
        }
        if (stage === 'center') check.aggregate = compareArray(await lane.backend.readCenter!(), centerAggregate(previous))
        stages.push(check)
      }
      previous = actual.positions
    }
    const check = whole ? { stages, wholeTick: compareArray(previous, whole), valid: false, restored: false } : undefined
    if (check) check.valid = check.wholeTick.valid && stages.every(s => s.forces.valid && s.positions.valid && s.flagsExact && s.aggregate?.valid !== false)
    return { positions: previous, check }
  }
  const restore = async (lane: Lane, saved: Float32Array): Promise<boolean> => {
    lane.backend.setPositions(saved)
    const restored = (await lane.backend.read()).positions
    const a = new Uint32Array(saved.buffer, saved.byteOffset, saved.length)
    const b = new Uint32Array(restored.buffer, restored.byteOffset, restored.length)
    const same = a.every((v, i) => v === b[i])
    if (!same) throw new Error('Diagnostic restore changed position bits')
    return same
  }
  const frozen = async (lane: Lane, start: Float32Array, value: number, tick: number, capture: boolean): Promise<Check> => {
    const saved = lane.positions; let result: Awaited<ReturnType<typeof execute>> | undefined
    try { lane.backend.setPositions(start); result = await execute(lane, start, value, tick, true) } finally {
      const restored = await restore(lane, saved)
      if (result?.check) result.check.restored = restored
    }
    const check = result!.check!
    if (capture && !check.valid && !report.captures[lane.name]) {
      report.captures[lane.name] = {
        tick: tick + 1, alpha: value, samples: parameters.samples, input: start.slice(), output: result!.positions.slice(), check,
      }
    }
    return check
  }
  const evaluate = async (probe: boolean, forceCheck: boolean): Promise<Row> => {
    if (busy || destroyed) throw new Error('Matched session unavailable')
    if (!probe && report.rows.length >= settings.ticks) throw new Error('Cooling schedule complete')
    busy = true
    const tick = report.rows.length; const value = probe ? 1 : alpha; const before = cpu
    try {
      // One deterministic CPU-derived decision is applied to every lane BEFORE
      // the tick. It removes wall-clock adaptation as a comparison variable.
      if (!probe && method === 'hierarchical' && settings.preset === 'adaptive' && tick % 30 === 0) {
        let beforeRepulsion = oracle.stage('gravity', before, value, tick).positions
        if (parameters.center) beforeRepulsion = oracle.stage('center', beforeRepulsion, value, tick).positions
        const frame = frameFor(beforeRepulsion, tick, parameters.samples, parameters.precise)
        const { aggregates } = buildReference(beforeRepulsion, frame)
        const finest = aggregates.slice(-(layout(settings.count).finest ** 2 * 4))
        const stats = { points: 0, overflow: [0, 0, 0] as [number, number, number] }
        for (let i = 2; i < finest.length; i += 4) {
          const n = finest[i]; stats.points += n
          for (let j = 0; j < 3; j++) if (n > [8, 16, 32][j]) stats.overflow[j] += n
        }
        const decision = sampler.collect(stats); parameters.samples = decision.applied
        for (const lane of lanes) lane.backend.setSampling!(parameters.samples)
        report.sampling.push({ tick: tick + 1, ...decision })
      }
      const nextCpu = oracle.tick(before, value, tick)
      const row: Row = { tick: tick + 1, alpha: value, samples: parameters.samples, quality: {}, checks: {}, complete: false }
      row.quality.cpu = quality(nextCpu, before, nextCpu, graph, parameters, sampled.pairs)
      const checked = probe || forceCheck || tick === 0 || tick + 1 === settings.ticks || (tick + 1) % settings.checkpointEvery === 0
      for (const lane of lanes) {
        if (report.errors[lane.name]) continue
        const previous = lane.positions
        try {
          let result: Awaited<ReturnType<typeof execute>>
          try { result = await execute(lane, previous, value, tick, false) } finally { if (probe) await restore(lane, previous) }
          row.quality[lane.name] = quality(result.positions, previous, nextCpu, graph, parameters, sampled.pairs)
          if (!probe) lane.positions = result.positions
          if (!row.quality[lane.name]!.shape.finite) throw new Error('Non-finite present positions')
          if (checked) row.checks[lane.name] = await frozen(lane, before, value, tick, !probe)
        } catch (error) { report.errors[lane.name] = String(error) }
      }
      row.complete = Object.keys(row.quality).length === 3 && !Object.keys(report.errors).length
      if (probe) report.probe = row
      else { cpu = nextCpu; alpha = cool(alpha, settings.ticks); report.rows.push(row); report.probe = undefined }
      return row
    } finally { busy = false }
  }
  return {
    settings,
    graph,
    lanes,
    report,
    cpu: () => cpu,
    alpha: () => alpha,
    step: (forceCheck = false) => evaluate(false, forceCheck),
    probe: () => evaluate(true, true),
    async replay (): Promise<void> {
      if (busy || destroyed) throw new Error('Matched session unavailable')
      busy = true; const savedSamples = parameters.samples
      try {
        for (const lane of lanes) {
          const capture = report.captures[lane.name]
          if (!capture || report.errors[lane.name]) continue
          parameters.samples = capture.samples; lane.backend.setSampling!(capture.samples)
          const saved = lane.positions; let reproduced = false; let restored = false
          try {
            lane.backend.setPositions(capture.input)
            const result = await execute(lane, capture.input, capture.alpha, capture.tick - 1, true)
            const bits = (v: Float32Array): Uint32Array => new Uint32Array(v.buffer, v.byteOffset, v.length)
            const expected = bits(capture.output)
            reproduced = result.check!.valid === false && bits(result.positions).every((v, i) => v === expected[i]) &&
              JSON.stringify(result.check!.stages) === JSON.stringify(capture.check.stages) &&
              JSON.stringify(result.check!.wholeTick) === JSON.stringify(capture.check.wholeTick)
          } finally { restored = await restore(lane, saved) }
          report.replays.push({ name: lane.name, reproduced, restored })
        }
      } finally {
        try {
          parameters.samples = savedSamples
          for (const lane of lanes) if (!report.errors[lane.name]) lane.backend.setSampling!(savedSamples)
        } finally { busy = false }
      }
    },
    destroy (): void { destroyed = true; lanes.forEach(l => l.backend.destroy()) },
  }
}
export type MatchedSession = Awaited<ReturnType<typeof createMatchedSession>>
