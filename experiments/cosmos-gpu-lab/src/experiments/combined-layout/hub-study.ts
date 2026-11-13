import { createDevice } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import { fitView } from '../many-body/backend'
import { compare, compareArray, TOLERANCE, type Snapshot } from '../many-body/reference'
import { compareArray as springCompare, TOLERANCE as SPRING_TOLERANCE } from '../weighted-links/reference'
import type { Measurement } from '../many-body/timing'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'
import { createHubGraph } from './hub-spring-data'
import { HUB_THRESHOLD, HUB_TILE, type SpringOptimization } from './hub-spring-source'
import { createOracle } from './reference'
import { differingBits } from './resident'
import { profileCheck, profileOrder, fingerprint } from './controlled-profile'
import { STAGES, SPRINGS, REPULSION, GRAVITY } from './data'
import type { StageTiming } from './stage-timing'
import { FROZEN_POLICY, type FrozenPolicy, type FrozenFrame, type FrozenTrial } from './frozen-timing'
export const HUB_POLICY = { warmups: 2, samples: 8, frames: 4 } as const
export const HUB_NORMAL_POLICY = FROZEN_POLICY
export type HubPolicy = FrozenPolicy
export type HubCapture = { positions: Float32Array; alpha: number; tick: number }
export type HubCase = {
  count: number; degree: number; pinned: boolean; optimization: Exclude<SpringOptimization, 'baseline'>; threshold?: number; repeat?: number;
}
type Frame = FrozenFrame
export type HubTrial = FrozenTrial
export type HubRow = HubCase & {
  threshold: number; alpha: number; tick: number; trials: HubTrial[]; valid: boolean; fingerprint?: string; error?: string; bufferBytes?: number[];
  stages: Array<{ stage: string; positions: number; forces: number; cpuValid: boolean }>;
  anchors: ReturnType<typeof profileCheck>[]; cleanup?: number[];
}
export type HubReport = {
  experiment: string; gpuApi: string; browser: string; info: string; policy: HubPolicy; tolerance: typeof TOLERANCE; springTolerance: typeof SPRING_TOLERANCE;
  algorithm: { tile: number; noHubDirection: 'baseline'; springs: typeof SPRINGS; repulsion: typeof REPULSION; gravity: number };
  sameDevice: boolean; status: 'ready' | 'running' | 'complete' | 'cancelled' | 'failed'; rows: HubRow[];
  captures: Record<string, { positions: number[]; samples: number[] }>; error?: string;
  failure?: { field: string; actual: { positions: number[]; forces: number[] }; expected: { positions: number[]; forces: number[] } };
}
function combine (frames: Array<Frame & { timing: Measurement }>): { timing: Measurement; stages?: StageTiming[]; check: Frame['check'] } {
  const valid = frames.every(f => f.timing.timerStatus === 'valid' && f.timing.batchGpuMs !== null &&
    Number.isFinite(f.timing.batchGpuMs) && f.timing.batchGpuMs >= 0)
  const timing: Measurement = {
    operations: frames.length,
    batchGpuMs: valid ? frames.reduce((sum, f) => sum + f.timing.batchGpuMs!, 0) : null,
    batchSubmitMs: frames.reduce((sum, f) => sum + f.timing.batchSubmitMs, 0),
    batchCompletionMs: frames.reduce((sum, f) => sum + f.timing.batchCompletionMs, 0),
    timerStatus: valid ? 'valid' : frames.find(f => f.timing.timerStatus !== 'valid')?.timing.timerStatus ?? 'invalid',
  }
  const stages = frames[0].stages?.map((s, i) => ({
    name: s.name,
    gpuMs: valid ? frames.reduce((sum, f) => sum + f.stages![i].gpuMs!, 0) / frames.length : null,
  }))
  const check = { ...frames[0].check, valid: frames.every(f => f.check.valid) }
  return { timing, stages, check }
}
export async function createHubStudy (canvas: HTMLCanvasElement, policy: HubPolicy = HUB_POLICY): Promise<{
  report: HubReport; run(cases: HubCase[], options: { capture?: HubCapture; cancelled(): boolean; progress(message: string): void }): Promise<void>;
  destroy(): void; remainingBytes(): number[];
}> {
  if (policy.samples < 4 || policy.samples > 32 || policy.samples % 4 || policy.frames < 1 || policy.frames > 8 ||
    policy.warmups < 0 || policy.warmups > 4 || ![policy.samples, policy.frames, policy.warmups].every(Number.isInteger)) {
    throw new Error('Invalid hub timing policy')
  }
  if (policy.batched && policy.diagnostics !== false) throw new Error('Batched hub timing supports normal frames only')
  let failure: string | undefined; let destroyed = false; let started = false
  const device = await createDevice('webgpu', canvas, true, error => { failure = error.message })
  const ledgers = [new BufferLedger(), new BufferLedger()]; let backends: CombinedBackend[] = []
  const check = (): void => { if (destroyed || failure || device.isLost) throw new Error(failure ?? 'Hub study device unavailable') }
  const remainingBytes = (): number[] => ledgers.map(l => l.liveBytes)
  const retire = (): void => {
    let firstError: unknown
    const owned = backends; backends = []
    for (const b of owned) { try { b.destroy() } catch (error) { firstError ??= error } }
    if (firstError) throw firstError
  }
  const report: HubReport = {
    experiment: 'hub-springs',
    gpuApi: 'luma',
    browser: navigator.userAgent,
    info: '',
    policy,
    tolerance: TOLERANCE,
    springTolerance: SPRING_TOLERANCE,
    algorithm: { tile: HUB_TILE, noHubDirection: 'baseline', springs: SPRINGS, repulsion: REPULSION, gravity: GRAVITY },
    sameDevice: true,
    status: 'ready',
    rows: [],
    captures: {},
  }
  const captureFailure = (field: string, actual: Snapshot, expected: Snapshot): void => {
    const arrays = (s: Snapshot): { positions: number[]; forces: number[] } => ({
      positions: Array.from(s.positions), forces: Array.from(s.forces),
    })
    report.failure ??= { field, actual: arrays(actual), expected: arrays(expected) }
  }
  return {
    report,
    remainingBytes,
    async run (cases, { cancelled, progress, capture }): Promise<void> {
      if (started) throw new Error('Hub study already started')
      started = true; report.status = 'running'
      const stop = (): boolean => { if (!cancelled()) return false; report.status = 'cancelled'; return true }
      try {
        for (const settings of cases) {
          if (stop()) return
          check()
          const alpha = capture?.alpha ?? 1; const tick = capture?.tick ?? 0
          const row: HubRow = {
            ...settings, threshold: settings.threshold ?? HUB_THRESHOLD, alpha, tick, trials: [], stages: [], anchors: [], valid: false,
          }; report.rows.push(row)
          try {
            if (!Number.isInteger(settings.count) || settings.count < 16 || settings.count > 8192) throw new Error('Hub study supports 16–8192 points')
            const { graph, input } = createHubGraph(settings.count, settings.degree, settings.pinned)
            if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1 || !Number.isInteger(tick) || tick < 0) throw new Error('Invalid captured frame')
            const frozen = capture?.positions.slice() ?? input.points.slice()
            if (frozen.length !== settings.count * 4 || !frozen.every(Number.isFinite)) throw new Error('Invalid captured positions')
            input.points = frozen; graph.points = frozen; const view = fitView([frozen]); const key = fingerprint(frozen)
            row.fingerprint = key
            report.captures[key] ??= { positions: Array.from(frozen), samples: Array.from(input.samples) }
            progress(`Preparing degree ${settings.degree} · ${settings.pinned ? 'pinned' : 'unpinned'} hub · ${settings.optimization}`)
            for (const [i, springOptimization] of (['baseline', settings.optimization] as const).entries()) {
              backends.push(await createCombinedWebGPU(canvas, graph, input, 'trig', {
                gpuBounds: true, springOptimization, hubThreshold: row.threshold, context: { device, ledger: ledgers[i], check },
              }))
            }
            report.info = backends[0].info; row.bufferBytes = remainingBytes()
            if (backends.some(b => b.positionSource!().device !== device)) throw new Error('Benchmark lanes must share one device')
            const oracle = createOracle(graph, input); const cpuWhole = oracle.tick(frozen, alpha, tick)
            let current: Float32Array = frozen; let staged: Snapshot | undefined
            for (const b of backends) b.setGpuFrame!(tick)
            for (const stage of STAGES) {
              if (stop()) return
              const cpu = oracle.stage(stage, current, alpha, tick)
              for (const b of backends) b.stepStage(stage, alpha)
              const snapshots = await Promise.all(backends.map(b => b.read()))
              const positions = differingBits(snapshots[0].positions, snapshots[1].positions)
              const forces = differingBits(snapshots[0].forces, snapshots[1].forces)
              const cpuValid = snapshots.every(s => stage === 'incoming' || stage === 'outgoing'
                ? springCompare(s.positions, cpu.positions).valid && springCompare(s.forces, cpu.forces).valid
                : compare(s, cpu).valid)
              row.stages.push({ stage, positions, forces, cpuValid })
              if (positions || forces || !cpuValid) {
                captureFailure(`stage ${stage}${cpuValid ? ' baseline replay' : ' CPU'}`, snapshots[1], cpuValid ? snapshots[0] : cpu)
                throw new Error(`Stage validation failed: ${JSON.stringify(row.stages.at(-1))}`)
              }
              current = snapshots[0].positions; staged = snapshots[0]
            }
            if (!compareArray(staged!.positions, cpuWhole).valid) {
              captureFailure('independent whole-tick CPU', staged!, { positions: cpuWhole, forces: new Float32Array() })
              throw new Error('Independent whole-tick CPU check failed')
            }
            for (const b of backends) {
              b.setPositions(frozen)
              const { snapshot } = await b.measureCurrentFrame!(alpha, tick, view)
              const check = profileCheck(snapshot, staged!, cpuWhole); row.anchors.push(check)
              if (!check.valid) {
                captureFailure('normal frame anchor', snapshot, staged!)
                throw new Error('Normal frame anchor differs from staged replay/CPU')
              }
            }
            const methods = [{ lane: 0, kind: 'normal' }, { lane: 1, kind: 'normal' },
              { lane: 0, kind: 'profile' }, { lane: 1, kind: 'profile' }] as const
            for (const warmup of [true, false]) {
              for (let round = 0; round < (warmup ? policy.warmups : policy.samples); round++) {
                const order = policy.diagnostics === false ? (round % 2 ? [1, 0] : [0, 1]) : profileOrder(round)
                for (const index of order) {
                  if (stop()) return
                  const { lane, kind } = methods[index]; const b = backends[lane]; const frames: Frame[] = []
                  progress(`Degree ${settings.degree} · ${settings.pinned ? 'pinned' : 'unpinned'} · ${warmup ? 'warmup' : 'sample'} ` +
                    `${round + 1}/${warmup ? policy.warmups : policy.samples} · ${lane ? settings.optimization : 'baseline'} · ${kind}`)
                  const validate = (snapshot: Snapshot): Frame['check'] => {
                    const check = profileCheck(snapshot, staged!, cpuWhole)
                    if (!check.valid) {
                      captureFailure('frame baseline replay', snapshot, staged!)
                      throw new Error(`Frame validation failed: ${JSON.stringify(check)}`)
                    }
                    return check
                  }
                  let aggregate: ReturnType<typeof combine>
                  if (policy.batched) {
                    b.setPositions(frozen)
                    const result = await b.measureFrozenFrames!({ frames: policy.frames, alpha, tick, view })
                    for (const [i, snapshot] of result.snapshots.entries()) frames.push({ gpuMs: result.frameGpuMs[i], check: validate(snapshot) })
                    aggregate = { timing: result.timing, check: { ...frames[0].check, valid: frames.every(f => f.check.valid) } }
                  } else {
                    const individual: Array<Frame & { timing: Measurement }> = []
                    for (let frame = 0; frame < policy.frames; frame++) {
                      if (stop()) return
                      b.setPositions(frozen)
                      const result: { timing: Measurement; stages?: StageTiming[]; snapshot: Snapshot } = kind === 'normal'
                        ? await b.measureCurrentFrame!(alpha, tick, view)
                        : await b.profileCurrentFrame!(alpha, tick, view)
                      individual.push({ timing: result.timing, stages: result.stages, check: validate(result.snapshot) })
                    }
                    frames.push(...individual); aggregate = combine(individual)
                  }
                  row.trials.push({ round, warmup, order, lane, kind, frames, ...aggregate })
                  await new Promise(resolve => setTimeout(resolve, 0))
                }
              }
            }
            row.valid = true
          } catch (error) { row.error = String(error); throw error } finally { retire(); row.cleanup = remainingBytes() }
        }
        report.status = 'complete'
      } catch (error) { report.status = 'failed'; report.error = String(error) }
    },
    destroy (): void { if (destroyed) return; destroyed = true; try { retire() } finally { device.destroy() } },
  }
}
export type HubStudy = Awaited<ReturnType<typeof createHubStudy>>
export { frozenSummary as hubSummary, frozenPairedWins as hubPairedWins } from './frozen-timing'
