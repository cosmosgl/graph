import { createDevice } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import { fitView } from '../many-body/backend'
import { createFixture } from '../many-body/data'
import { compare, compareArray, TOLERANCE, type Snapshot } from '../many-body/reference'
import { compareArray as springCompare, TOLERANCE as SPRING_TOLERANCE } from '../weighted-links/reference'
import { aggregationWork, aggregationLimit, type AggregationMode } from '../many-body-grid/aggregation'
import { buildReference, frameFor } from '../many-body-grid/data'
import { centroidReference } from '../many-body-grid/centroids'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'
import { createOracle } from './reference'
import { createGraph, cool, STAGES, GRAVITY, SPRINGS, REPULSION, type Fixture } from './data'
import { differingBits } from './resident'
import { fingerprint, profileCheck, type ProfileCheck } from './controlled-profile'
import { FROZEN_POLICY, type FrozenTrial, type FrozenPolicy } from './frozen-timing'

export type GridCase = {
  count: number; fixture: Extract<Fixture, 'chain' | 'communities'>; distribution: 'uniform' | 'clusters';
  historyTicks: number; candidate: AggregationMode; repeat?: number;
}
export type GridRow = GridCase & {
  valid: boolean; alpha: number; tick: number; fingerprint?: string; error?: string; cleanup?: number[]; bufferBytes?: number[];
  preparation: ProfileCheck[]; anchors: ProfileCheck[]; trials: FrozenTrial[]; diagnostic: FrozenTrial[];
  stages: Array<{ stage: string; positions: number; forces: number; cpuValid: boolean }>;
  work?: ReturnType<typeof aggregationWork>;
  candidateWork?: ReturnType<typeof aggregationWork>;
  wholeCPU?: ReturnType<typeof compareArray>;
  structure?: { aggregates: number; slots: number; centroids: number; cpuAggregates: number; cpuCentroids: number; bounds: number };
}
export type GridReport = {
  experiment: 'grid-aggregation'; gpuApi: 'luma'; browser: string; info: string; sameDevice: boolean;
  policy: FrozenPolicy; tolerance: typeof TOLERANCE; springTolerance: typeof SPRING_TOLERANCE;
  diagnosticPolicy: { warmups: number; samples: number; frames: number; separatePhase: boolean };
  algorithm: { gravity: number; springs: typeof SPRINGS; repulsion: typeof REPULSION; coolingDecay: number; slots: number; centroidMode: string };
  status: 'ready' | 'running' | 'complete' | 'cancelled' | 'failed'; rows: GridRow[]; error?: string;
  captures: Record<string, { positions: number[]; samples: number[]; alpha: number; tick: number }>;
  failure?: { stage: string; input: number[]; actual: { positions: number[]; forces: number[] }; expected: { positions: number[]; forces: number[] } };
}
export async function createGridStudy (canvas: HTMLCanvasElement, policy: FrozenPolicy = FROZEN_POLICY): Promise<{
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
    experiment: 'grid-aggregation',
    gpuApi: 'luma',
    browser: navigator.userAgent,
    info: '',
    sameDevice: true,
    policy,
    diagnosticPolicy: { warmups: policy.warmups, samples: policy.samples, frames: 1, separatePhase: true },
    algorithm: { gravity: GRAVITY, springs: SPRINGS, repulsion: REPULSION, coolingDecay: 100, slots: 8, centroidMode: 'streamed' },
    tolerance: TOLERANCE,
    springTolerance: SPRING_TOLERANCE,
    status: 'ready',
    rows: [],
    captures: {},
  }
  const fail = (stage: string, input: Float32Array, actual: Snapshot, expected: Snapshot): void => {
    const arrays = (s: Snapshot): { positions: number[]; forces: number[] } => ({ positions: Array.from(s.positions), forces: Array.from(s.forces) })
    report.failure ??= { stage, input: Array.from(input), actual: arrays(actual), expected: arrays(expected) }
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
              !Number.isInteger(settings.historyTicks) || settings.historyTicks < 0 || settings.historyTicks > 20) {
              throw new Error('Invalid grid study size/history')
            }
            const { graph, input } = createGraph({ count: settings.count, fixture: settings.fixture, decay: 100, springPrecision: 'trig' })
            input.points = createFixture(settings.distribution, settings.count).points; graph.points = input.points
            input.points[2] = 1; input.points[7] = 1 // A pinned mass and a finite absent record.
            const oracle = createOracle(graph, input)
            progress(`Preparing ${settings.fixture} · ${settings.distribution} · ${settings.count} points`)
            for (const [lane, gridAggregation] of (['baseline', settings.candidate] as const).entries()) {
              backends.push(await createCombinedWebGPU(canvas, graph, input, 'trig', {
                gpuBounds: true, gridAggregation, context: { device, ledger: ledgers[lane], check },
              }))
            }
            report.info = backends[0].info; row.bufferBytes = remainingBytes()
            if (backends.some(b => b.positionSource!().device !== device)) throw new Error('Grid variants must share one device')
            let frozen: Float32Array = input.points.slice()
            for (let tick = 0; tick < settings.historyTicks; tick++) {
              if (stop()) return
              const cpu = oracle.tick(frozen, row.alpha, tick)
              for (const b of backends) b.stepTick!(row.alpha, tick)
              const snapshots = await Promise.all(backends.map(b => b.read()))
              const checks = snapshots.map(s => profileCheck(s, snapshots[0], cpu)); row.preparation.push(...checks)
              if (!checks.every(c => c.valid)) {
                const cpuFailure = checks.some(c => !c.cpu.valid)
                fail(cpuFailure ? 'preparation whole-tick CPU' : 'preparation GPU replay', frozen, snapshots[1],
                  cpuFailure ? { positions: cpu, forces: new Float32Array() } : snapshots[0])
                throw new Error(`Preparation failed at tick ${tick + 1}`)
              }
              frozen = snapshots[0].positions; row.alpha = cool(row.alpha, 100); row.tick++
            }
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
              const cpuValid = snapshots.every(s => stage === 'incoming' || stage === 'outgoing'
                ? springCompare(s.positions, cpu.positions).valid && springCompare(s.forces, cpu.forces).valid
                : compare(s, cpu).valid)
              row.stages.push({ stage, positions, forces, cpuValid })
              if (positions || forces || !cpuValid) {
                fail(stage, current, snapshots[1], cpuValid ? snapshots[0] : cpu); throw new Error(`Stage validation failed: ${stage}`)
              }
              if (stage === 'repulsion') {
                const frame = frameFor(current, row.tick); const expected = buildReference(current, frame)
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
