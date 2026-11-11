import { createDevice } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import { fitView } from '../many-body/backend'
import { createFixture } from '../many-body/data'
import { compare, compareArray, TOLERANCE, type Snapshot } from '../many-body/reference'
import { compareArray as springCompare, TOLERANCE as SPRING_TOLERANCE } from '../weighted-links/reference'
import { aggregationWork, aggregationLimit, type AggregationMode } from '../many-body-grid/aggregation'
import { buildReference, frameFor, layout } from '../many-body-grid/data'
import { centroidReference } from '../many-body-grid/centroids'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'
import { createOracle } from './reference'
import { createGraph, cool, STAGES, GRAVITY, SPRINGS, REPULSION, type Fixture } from './data'
import { differingBits } from './resident'
import { fingerprint, profileCheck, type ProfileCheck } from './controlled-profile'
import { FROZEN_POLICY, type FrozenTrial, type FrozenPolicy } from './frozen-timing'
import { repulsionMethod, type RepulsionPolicy, type RepulsionMethod } from './repulsion-policy'
import type { SpringOptimization } from './hub-spring-source'
import { forceSettings, createSamplingPolicy, type ProductionPreset, type ForceSettings, type Occupancy } from './production-settings'
import { validateCheckpoint, type CheckpointResult } from './checkpoint'

export type GridCase = {
  count: number; fixture: Extract<Fixture, 'chain' | 'communities' | 'star'>; distribution: 'uniform' | 'clusters';
  historyTicks: number; candidate: AggregationMode; repeat?: number; decay?: number; probe?: boolean; pinned?: boolean;
  repulsionPolicy?: RepulsionPolicy; springOptimization?: SpringOptimization;
  preset?: ProductionPreset; checkpointEvery?: number;
}
export type GridRow = GridCase & {
  valid: boolean; alpha: number; tick: number; cooledAlpha?: number; method?: RepulsionMethod;
  fingerprint?: string; error?: string; cleanup?: number[]; bufferBytes?: number[];
  preparation: ProfileCheck[]; anchors: ProfileCheck[]; trials: FrozenTrial[]; diagnostic: FrozenTrial[];
  stages: Array<{ stage: string; positions: number; forces: number; cpuValid: boolean }>;
  forceSettings?: ForceSettings; checkpoints?: Array<Pick<CheckpointResult, 'stages' | 'normal' | 'valid'> & { tick: number; alpha: number; samples: number }>;
  activeSamples?: number; sampleCapacity?: number;
  sampling?: Array<{ tick: number; stats: Occupancy; wanted: number; applied: number; changed: boolean; readMs: number; nextNotBeforeMs: number }>;
  replay?: { fromTick: number; throughTick: number; firstFailureTick?: number; reproduced: boolean };
  work?: ReturnType<typeof aggregationWork>;
  candidateWork?: ReturnType<typeof aggregationWork>;
  wholeCPU?: ReturnType<typeof compareArray>;
  structure?: { aggregates: number; slots: number; centroids: number; cpuAggregates: number; cpuCentroids: number; bounds: number };
}
export type GridReport = {
  experiment: 'grid-aggregation' | 'layout-acceptance'; gpuApi: 'luma'; browser: string; info: string; sameDevice: boolean;
  policy: FrozenPolicy; tolerance: typeof TOLERANCE; springTolerance: typeof SPRING_TOLERANCE;
  diagnosticPolicy: { warmups: number; samples: number; frames: number; separatePhase: boolean };
  algorithm: { gravity: number; springs: typeof SPRINGS; repulsion: typeof REPULSION; defaultCoolingDecay: number; slots: number;
    centroidMode: string; hubThreshold: number; };
  status: 'ready' | 'running' | 'complete' | 'cancelled' | 'failed'; rows: GridRow[]; error?: string;
  captures: Record<string, { positions: number[]; samples: number[]; alpha: number; tick: number }>;
  failure?: { stage: string; input: number[]; actual: { positions: number[]; forces: number[] }; expected: { positions: number[]; forces: number[] };
    tick?: number; alpha?: number; samples?: number; row?: number; tickInput?: number[]; };
}
export async function createGridStudy (
  canvas: HTMLCanvasElement, policy: FrozenPolicy = FROZEN_POLICY, experiment: GridReport['experiment'] = 'grid-aggregation'
): Promise<{
  report: GridReport; run(cases: GridCase[], options: { cancelled(): boolean; progress(message: string): void }): Promise<void>;
  destroy(): void; remainingBytes(): number[];
}> {
  if (![policy.samples, policy.warmups, policy.frames].every(Number.isInteger) || policy.samples < 4 || policy.samples % 2 ||
    policy.samples > 32 || policy.warmups < 0 || policy.warmups > 4 || policy.frames < 1 || policy.frames > 8) throw new Error('Invalid grid timing policy')
  let failure: string | undefined; let destroyed = false; let started = false
  const device = await createDevice('webgpu', canvas, true, e => { failure = e.message })
  const ledgers = [new BufferLedger(), new BufferLedger()]; let backends: CombinedBackend[] = []
  const check = (): void => { if (destroyed || failure || device.isLost) throw new Error(failure ?? 'Grid study unavailable') }
  const remainingBytes = (): number[] => ledgers.map(l => l.liveBytes)
  const retire = (): void => {
    const owned = backends; backends = []; let firstError: unknown
    for (const b of owned) { try { b.destroy() } catch (error) { firstError ??= error } }
    if (firstError) throw firstError
  }
  const report: GridReport = {
    experiment,
    gpuApi: 'luma',
    browser: navigator.userAgent,
    info: '',
    sameDevice: true,
    policy,
    diagnosticPolicy: { warmups: policy.warmups, samples: policy.samples, frames: 1, separatePhase: true },
    algorithm: {
      gravity: GRAVITY,
      springs: SPRINGS,
      repulsion: REPULSION,
      defaultCoolingDecay: 100,
      slots: 8,
      centroidMode: 'streamed',
      hubThreshold: 1024,
    },
    tolerance: TOLERANCE,
    springTolerance: SPRING_TOLERANCE,
    status: 'ready',
    rows: [],
    captures: {},
  }
  const fail = (stage: string, input: Float32Array, actual: Snapshot, expected: Snapshot): void => {
    const arrays = (s: Snapshot): { positions: number[]; forces: number[] } => ({ positions: Array.from(s.positions), forces: Array.from(s.forces) })
    const row = report.rows.at(-1)
    report.failure ??= {
      stage,
      input: Array.from(input),
      actual: arrays(actual),
      expected: arrays(expected),
      tick: row?.tick,
      alpha: row?.alpha,
      samples: row?.activeSamples,
      row: report.rows.length - 1,
    }
  }
  return {
    report,
    remainingBytes,
    destroy (): void { if (destroyed) return; destroyed = true; try { retire() } finally { device.destroy() } },
    async run (cases, { cancelled, progress }): Promise<void> {
      if (started) throw new Error('Grid study already started')
      started = true; report.status = 'running'
      const stop = (): boolean => { if (!cancelled()) return false; report.status = 'cancelled'; return true }
      try {
        for (const settings of cases) {
          if (stop()) return
          check()
          const row: GridRow = { ...settings, valid: false, alpha: 1, tick: 0, preparation: [], anchors: [], trials: [], diagnostic: [], stages: [] }
          report.rows.push(row)
          try {
            if (!Number.isInteger(settings.count) || settings.count < 16 || settings.count > 8192 ||
              !Number.isInteger(settings.historyTicks) || settings.historyTicks < 0 || settings.historyTicks > 5000 ||
              !Number.isInteger(settings.decay ?? 100) || (settings.decay ?? 100) < 1 || (settings.decay ?? 100) > 5000 ||
              !Number.isInteger(settings.checkpointEvery ?? 1) || (settings.checkpointEvery ?? 1) < 1) {
              throw new Error('Invalid grid study size/history')
            }
            const decay = settings.decay ?? 100
            const { graph, input } = createGraph({ count: settings.count, fixture: settings.fixture, decay, springPrecision: 'trig' })
            input.points = createFixture(settings.distribution, settings.count).points; graph.points = input.points
            input.points[2] = settings.pinned === false ? 0 : 1; input.points[7] = 1 // A finite absent record.
            const forceConfig = forceSettings(settings.preset ?? 'reference', settings.count)
            row.forceSettings = { ...forceConfig, variation: [...forceConfig.variation] }
            row.activeSamples = forceConfig.samples; row.sampleCapacity = settings.preset === 'adaptive' ? 64 : forceConfig.samples
            row.checkpoints = []; row.sampling = []
            const oracle = createOracle(graph, input, settings.repulsionPolicy, forceConfig)
            const adaptive = settings.preset === 'adaptive' ? createSamplingPolicy(settings.count) : undefined
            row.method = repulsionMethod(settings.count, settings.repulsionPolicy ?? 'hierarchical')
            progress(`Preparing ${settings.fixture} · ${settings.distribution} · ${settings.count} points`)
            for (const [lane, gridAggregation] of (['baseline', settings.candidate] as const).entries()) {
              backends.push(await createCombinedWebGPU(canvas, graph, input, 'trig', {
                gpuBounds: true,
                gridAggregation,
                repulsionPolicy: settings.repulsionPolicy,
                springOptimization: lane ? settings.springOptimization : 'baseline',
                hubThreshold: 1024,
                forceSettings: forceConfig,
                adaptiveSampling: Boolean(adaptive),
                context: { device, ledger: ledgers[lane], check },
              }))
            }
            report.info = backends[0].info; row.bufferBytes = remainingBytes()
            if (backends.some(b => b.positionSource!().device !== device)) throw new Error('Grid variants must share one device')
            let frozen: Float32Array = input.points.slice()
            let trusted = { points: frozen, tick: 0, alpha: 1, samples: forceConfig.samples }
            let lastMeasurement: number | undefined; let notBefore = 0
            for (let tick = 0; tick < settings.historyTicks; tick++) {
              if (stop()) return
              progress(`Evolving ${settings.count} ${settings.fixture} ${settings.distribution} · tick ${tick + 1}/${settings.historyTicks}`)
              const measure = Boolean(adaptive && row.method === 'hierarchical' && performance.now() >= notBefore &&
                (lastMeasurement === undefined || tick - lastMeasurement >= 30))
              const checked = measure || tick === 0 || tick + 1 === settings.historyTicks || (tick + 1) % (settings.checkpointEvery ?? 1) === 0
              const start = checked ? (await backends[0].read()).positions : undefined
              if (measure) for (const b of backends) b.requestOccupancy!()
              for (const b of backends) b.stepTick!(row.alpha, tick)
              if (checked) {
                // Read occupancy before replay overwrites the ordinary grid.
                const readStarted = performance.now()
                const stats = measure ? await Promise.all(backends.map(b => b.readOccupancy!())) : undefined
                const readMs = performance.now() - readStarted
                const snapshots = await Promise.all(backends.map(b => b.read()))
                const cpu = oracle.tick(start!, row.alpha, tick)
                const checks = snapshots.map(s => profileCheck(s, snapshots[0], cpu)); row.preparation.push(...checks)
                const stages = settings.checkpointEvery !== undefined
                  ? await validateCheckpoint(backends, oracle, start!, row.alpha, tick, snapshots)
                  : undefined
                if (stages) {
                  row.checkpoints.push({
                    stages: stages.stages,
                    normal: stages.normal,
                    valid: stages.valid,
                    tick: tick + 1,
                    alpha: row.alpha,
                    samples: forceConfig.samples,
                  })
                }
                if (!checks.every(c => c.valid) || (stages && !stages.valid)) {
                  const failure = stages?.failure
                  if (failure) fail(failure.stage, failure.input, failure.actual, failure.expected)
                  else {
                    const lane = Math.max(0, checks.findIndex(c => !c.valid))
                    fail('preparation whole-tick CPU / GPU replay', start!, snapshots[lane],
                      checks[lane].cpu.valid ? snapshots[0] : { positions: cpu, forces: new Float32Array() })
                  }
                  if (report.failure?.row === report.rows.length - 1) {
                    Object.assign(report.failure,
                      { tick, alpha: row.alpha, samples: forceConfig.samples, row: report.rows.length - 1, tickInput: Array.from(start!) })
                  }
                  // Bounded replay narrows a sparse-checkpoint failure without
                  // injecting any reference positions or changing tolerance.
                  row.replay = { fromTick: trusted.tick, throughTick: tick, reproduced: false }
                  const failedSamples = forceConfig.samples
                  for (const b of backends) { b.setPositions(trusted.points); b.setSampling!(trusted.samples) }
                  forceConfig.samples = trusted.samples; let alpha = trusted.alpha; let previous = trusted.points
                  for (let t = trusted.tick; t <= tick; t++) {
                    if (stop()) return
                    for (const b of backends) b.stepTick!(alpha, t)
                    const replay = await Promise.all(backends.map(b => b.read()))
                    const check = await validateCheckpoint(backends, oracle, previous, alpha, t, replay)
                    if (!check.valid) {
                      row.replay.firstFailureTick = t + 1; row.replay.reproduced = true
                      if (check.failure && report.failure?.row === report.rows.length - 1) {
                        report.failure = undefined; fail(`replay ${check.failure.stage}`, check.failure.input, check.failure.actual, check.failure.expected)
                        Object.assign(report.failure!,
                          { tick: t, alpha, samples: forceConfig.samples, row: report.rows.length - 1, tickInput: Array.from(previous) })
                      }
                      break
                    }
                    previous = replay[0].positions; alpha = cool(alpha, decay)
                  }
                  forceConfig.samples = failedSamples
                  const outcome = row.replay.reproduced ? `first failed at ${row.replay.firstFailureTick}` : 'did not reproduce'
                  throw new Error(`Preparation failed at tick ${tick + 1}; replay ${outcome}`)
                }
                frozen = snapshots[0].positions
                if (stats) {
                  if (JSON.stringify(stats[0]) !== JSON.stringify(stats[1])) throw new Error('GPU occupancy lanes differ')
                  const gravity = oracle.stage('gravity', start!, row.alpha, tick).positions
                  const frame = frameFor(gravity, tick, forceConfig.samples, forceConfig.precise); const structure = buildReference(gravity, frame)
                  const finest = structure.aggregates.slice(-(layout(settings.count).finest ** 2) * 4)
                  const expected: Occupancy = { points: 0, overflow: [0, 0, 0] }
                  for (let i = 2; i < finest.length; i += 4) {
                    const n = finest[i]; expected.points += n
                    for (const [j, k] of [8, 16, 32].entries()) if (n > k) expected.overflow[j] += n
                  }
                  if (JSON.stringify(stats[0]) !== JSON.stringify(expected)) throw new Error('GPU occupancy differs from CPU counts')
                  const decision = adaptive!.collect(stats[0]); lastMeasurement = tick
                  notBefore = performance.now() + readMs / 0.01
                  row.sampling.push({ tick, stats: stats[0], ...decision, readMs, nextNotBeforeMs: notBefore })
                  forceConfig.samples = decision.applied
                  row.activeSamples = forceConfig.samples
                  for (const b of backends) b.setSampling!(forceConfig.samples)
                }
                trusted = { points: frozen, tick: tick + 1, alpha: cool(row.alpha, decay), samples: forceConfig.samples }
              }
              row.alpha = cool(row.alpha, decay); row.tick++
              if (tick === 0 || (tick + 1) % 10 === 0) backends[0].render(fitView([frozen]))
              await new Promise(resolve => setTimeout(resolve, 0))
            }
            row.cooledAlpha = row.alpha
            if (settings.probe) row.alpha = 1
            row.fingerprint = fingerprint(frozen)
            report.captures[row.fingerprint] = { positions: Array.from(frozen), samples: Array.from(input.samples), alpha: row.alpha, tick: row.tick }
            const view = fitView([frozen]); const cpuWhole = oracle.tick(frozen, row.alpha, row.tick)
            for (const b of backends) { b.setPositions(frozen); b.setGpuFrame!(row.tick) }
            let current: Float32Array = frozen; let staged: Snapshot | undefined
            for (const stage of STAGES) {
              if (stop()) return
              const cpu = oracle.stage(stage, current, row.alpha, row.tick)
              for (const b of backends) b.stepStage(stage, row.alpha)
              const snapshots = await Promise.all(backends.map(b => b.read()))
              const positions = differingBits(snapshots[0].positions, snapshots[1].positions)
              const forces = differingBits(snapshots[0].forces, snapshots[1].forces)
              const cpuChecks = snapshots.map(s => stage === 'incoming' || stage === 'outgoing'
                ? springCompare(s.positions, cpu.positions).valid && springCompare(s.forces, cpu.forces).valid
                : compare(s, cpu).valid)
              const cpuValid = cpuChecks.every(Boolean)
              row.stages.push({ stage, positions, forces, cpuValid })
              if (positions || forces || !cpuValid) {
                const cpuLane = cpuChecks.findIndex(valid => !valid)
                fail(stage, current, snapshots[cpuLane < 0 ? 1 : cpuLane], cpuValid ? snapshots[0] : cpu)
                throw new Error(`Stage validation failed: ${stage}`)
              }
              if (stage === 'repulsion' && row.method === 'hierarchical') {
                const frame = frameFor(current, row.tick, forceConfig.samples, forceConfig.precise); const expected = buildReference(current, frame)
                const structures = await Promise.all(backends.map(b => b.readStructure()))
                const centers = await Promise.all(backends.map(b => b.readCentroids!()))
                const bounds = await Promise.all(backends.map(b => b.readBounds!()))
                row.work = aggregationWork(current, frame)
                row.candidateWork = aggregationWork(current, frame, aggregationLimit(settings.candidate))
                row.structure = {
                  aggregates: differingBits(structures[0].aggregates, structures[1].aggregates),
                  slots: differingBits(structures[0].slots, structures[1].slots),
                  centroids: differingBits(centers[0], centers[1]),
                  cpuAggregates: differingBits(structures[1].aggregates, expected.aggregates),
                  cpuCentroids: differingBits(centers[1], centroidReference(expected)),
                  bounds: differingBits(bounds[0], bounds[1]),
                }
                if (Object.values(row.structure).some(Boolean)) throw new Error(`Grid structure differs: ${JSON.stringify(row.structure)}`)
              }
              current = snapshots[0].positions; staged = snapshots[0]
            }
            row.wholeCPU = compareArray(staged!.positions, cpuWhole)
            if (!row.wholeCPU.valid) {
              fail('baseline whole-tick positions CPU', frozen, staged!, { positions: cpuWhole, forces: new Float32Array() })
              throw new Error(`Whole-tick CPU gate failed: ${JSON.stringify(row.wholeCPU)}`)
            }
            const validate = (actual: Snapshot): ProfileCheck => {
              const check = profileCheck(actual, staged!, cpuWhole)
              if (!check.valid) { fail('normal/profile replay', frozen, actual, staged!); throw new Error('Frame replay/CPU gate failed') }
              return check
            }
            for (const b of backends) { b.setPositions(frozen); row.anchors.push(validate((await b.measureCurrentFrame!(row.alpha, row.tick, view)).snapshot)) }
            // Separate phases: diagnostic pass boundaries never enter normal timing.
            for (const kind of ['normal', 'profile'] as const) {
              if (kind === 'profile' && row.method === 'exact') continue
              for (const warmup of [true, false]) {
                const rounds = warmup ? policy.warmups : policy.samples
                for (let round = 0; round < rounds; round++) {
                  const order = round % 2 ? [1, 0] : [0, 1]
                  for (const lane of order) {
                    if (stop()) return
                    const b = backends[lane]
                    progress(`${settings.count} ${settings.distribution} · ${kind} · ${warmup ? 'warmup' : 'sample'} ` +
                      `${round + 1}/${rounds} · ${lane ? settings.candidate : 'baseline'}`)
                    b.setPositions(frozen)
                    if (kind === 'normal') {
                      const result = await b.measureFrozenFrames!({ frames: policy.frames, alpha: row.alpha, tick: row.tick, view })
                      const frames = result.snapshots.map((s, i) => ({ gpuMs: result.frameGpuMs[i], check: validate(s) }))
                      row.trials.push({ round, warmup, order, lane, kind, timing: result.timing, frames, check: frames[0].check })
                    } else {
                      const result = await b.profileCurrentFrame!(row.alpha, row.tick, view); const check = validate(result.snapshot)
                      row.diagnostic.push({
                        round,
                        warmup,
                        order,
                        lane,
                        kind,
                        timing: result.timing,
                        stages: result.stages,
                        frames: [{ timing: result.timing, stages: result.stages, check }],
                        check,
                      })
                    }
                    await new Promise(resolve => setTimeout(resolve, 0))
                  }
                }
              }
            }
            row.valid = true
          } catch (error) {
            row.error = String(error); report.error ??= row.error
            if (device.isLost || failure || destroyed) throw error
          } finally { retire(); row.cleanup = remainingBytes() }
        }
        report.status = report.rows.every(row => row.valid) ? 'complete' : 'failed'
      } catch (error) { report.status = 'failed'; report.error = String(error) }
    },
  }
}
export type GridStudy = Awaited<ReturnType<typeof createGridStudy>>
