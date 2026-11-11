import { createDevice } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import { fitView } from '../many-body/backend'
import { compare, compareArray, TOLERANCE, type Snapshot } from '../many-body/reference'
import type { Measurement } from '../many-body/timing'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'
import { createHubGraph } from './hub-spring-data'
import { HUB_THRESHOLD, HUB_TILE, type SpringOptimization } from './hub-spring-source'
import { createOracle } from './reference'
import { differingBits } from './resident'
import { profileCheck, profileOrder, fingerprint, type ProfileTrial } from './controlled-profile'
import { STAGES, SPRINGS, REPULSION, GRAVITY } from './data'
import type { StageTiming } from './stage-timing'
export const HUB_POLICY = { warmups: 2, samples: 8, frames: 4 } as const
export type HubPolicy = { warmups: number; samples: number; frames: number }
export type HubCase = { count: number; degree: number; pinned: boolean; optimization: Exclude<SpringOptimization, 'baseline'> }
type Frame = { timing: Measurement; stages?: StageTiming[]; check: ReturnType<typeof profileCheck> }
export type HubTrial = ProfileTrial & { frames: Frame[] }
export type HubRow = HubCase & {
  trials: HubTrial[]; valid: boolean; fingerprint?: string; error?: string; bufferBytes?: number[];
  stages: Array<{ stage: string; positions: number; forces: number; cpuValid: boolean }>;
  anchors: ReturnType<typeof profileCheck>[]; cleanup?: number[];
}
export type HubReport = {
  experiment: string; gpuApi: string; browser: string; info: string; policy: HubPolicy; tolerance: typeof TOLERANCE;
  algorithm: { threshold: number; tile: number; springs: typeof SPRINGS; repulsion: typeof REPULSION; gravity: number; alpha: number; tick: number };
  sameDevice: boolean; status: 'ready' | 'running' | 'complete' | 'cancelled' | 'failed'; rows: HubRow[];
  captures: Record<string, { positions: number[]; samples: number[] }>; error?: string;
  failure?: { field: string; actual: { positions: number[]; forces: number[] }; expected: { positions: number[]; forces: number[] } };
}
function combine (frames: Frame[]): { timing: Measurement; stages?: StageTiming[]; check: Frame['check'] } {
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
  report: HubReport; run(cases: HubCase[], options: { cancelled(): boolean; progress(message: string): void }): Promise<void>;
  destroy(): void; remainingBytes(): number[];
}> {
  if (policy.samples < 4 || policy.samples > 32 || policy.samples % 4 || policy.frames < 1 || policy.frames > 8 ||
    policy.warmups < 0 || policy.warmups > 4 || !Object.values(policy).every(Number.isInteger)) throw new Error('Invalid hub timing policy')
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
    algorithm: { threshold: HUB_THRESHOLD, tile: HUB_TILE, springs: SPRINGS, repulsion: REPULSION, gravity: GRAVITY, alpha: 1, tick: 0 },
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
    async run (cases, { cancelled, progress }): Promise<void> {
      if (started) throw new Error('Hub study already started')
      started = true; report.status = 'running'
      const stop = (): boolean => { if (!cancelled()) return false; report.status = 'cancelled'; return true }
      try {
        for (const settings of cases) {
          if (stop()) return
          check()
          const row: HubRow = { ...settings, trials: [], stages: [], anchors: [], valid: false }; report.rows.push(row)
          try {
            if (!Number.isInteger(settings.count) || settings.count < 16 || settings.count > 8192) throw new Error('Hub study supports 16–8192 points')
            const { graph, input } = createHubGraph(settings.count, settings.degree, settings.pinned)
            const frozen = input.points.slice(); const view = fitView([frozen]); const key = fingerprint(frozen)
            row.fingerprint = key
            report.captures[key] ??= { positions: Array.from(frozen), samples: Array.from(input.samples) }
            progress(`Preparing degree ${settings.degree} · ${settings.pinned ? 'pinned' : 'unpinned'} hub · ${settings.optimization}`)
            for (const [i, springOptimization] of (['baseline', settings.optimization] as const).entries()) {
              backends.push(await createCombinedWebGPU(canvas, graph, input, 'trig', {
                gpuBounds: true, springOptimization, context: { device, ledger: ledgers[i], check },
              }))
            }
            report.info = backends[0].info; row.bufferBytes = remainingBytes()
            if (backends.some(b => b.positionSource!().device !== device)) throw new Error('Benchmark lanes must share one device')
            const oracle = createOracle(graph, input); const cpuWhole = oracle.tick(frozen, 1, 0)
            let current: Float32Array = frozen; let staged: Snapshot | undefined
            for (const b of backends) b.setGpuFrame!(0)
            for (const stage of STAGES) {
              if (stop()) return
              const cpu = oracle.stage(stage, current, 1, 0)
              for (const b of backends) b.stepStage(stage, 1)
              const snapshots = await Promise.all(backends.map(b => b.read()))
              const positions = differingBits(snapshots[0].positions, snapshots[1].positions)
              const forces = differingBits(snapshots[0].forces, snapshots[1].forces)
              const cpuValid = snapshots.every(s => compare(s, cpu).valid)
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
              const { snapshot } = await b.measureCurrentFrame!(1, 0, view)
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
                const order = profileOrder(round)
                for (const index of order) {
                  if (stop()) return
                  const { lane, kind } = methods[index]; const b = backends[lane]; const frames: Frame[] = []
                  progress(`Degree ${settings.degree} · ${settings.pinned ? 'pinned' : 'unpinned'} · ${warmup ? 'warmup' : 'sample'} ` +
                    `${round + 1}/${warmup ? policy.warmups : policy.samples} · ${lane ? settings.optimization : 'baseline'} · ${kind}`)
                  for (let frame = 0; frame < policy.frames; frame++) {
                    if (stop()) return
                    b.setPositions(frozen)
                    const result: { timing: Measurement; stages?: StageTiming[]; snapshot: Snapshot } = kind === 'normal'
                      ? await b.measureCurrentFrame!(1, 0, view)
                      : await b.profileCurrentFrame!(1, 0, view)
                    const check = profileCheck(result.snapshot, staged!, cpuWhole)
                    frames.push({ timing: result.timing, stages: result.stages, check })
                    if (!check.valid) {
                      captureFailure('frame baseline replay', result.snapshot, staged!)
                      throw new Error(`Frame validation failed: ${JSON.stringify(check)}`)
                    }
                  }
                  row.trials.push({ round, warmup, order, lane, kind, frames, ...combine(frames) })
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
export function hubSummary (row: HubRow, policy: HubPolicy, lane: number, kind: ProfileTrial['kind'], stage?: string): {
  samples: number; median: number | null; range: [number, number] | null;
} {
  const trials = row.trials.filter(t => !t.warmup && t.lane === lane && t.kind === kind)
  const values = trials.map(t => stage
    ? t.stages?.find(s => s.name === stage)?.gpuMs
    : t.timing.batchGpuMs === null ? null : t.timing.batchGpuMs / t.timing.operations)
  if (trials.length !== policy.samples || trials.some(t => !t.check.valid || t.timing.timerStatus !== 'valid') ||
    values.some(n => n === undefined || n === null || !Number.isFinite(n) || n < 0)) return { samples: trials.length, median: null, range: null }
  const sorted = [...values as number[]].sort((a, b) => a - b); const n = sorted.length / 2
  return { samples: trials.length, median: (sorted[n - 1] + sorted[n]) / 2, range: [sorted[0], sorted.at(-1)!] }
}
