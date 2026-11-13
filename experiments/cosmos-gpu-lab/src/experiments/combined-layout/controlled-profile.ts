import { fitView } from '../many-body/backend'
import { compareArray, TOLERANCE, type Check, type Snapshot } from '../many-body/reference'
import type { Measurement } from '../many-body/timing'
import { createCapacitySession } from './capacity-session'
import { createOracle } from './reference'
import { differingBits } from './resident'
import type { Fixture } from './data'
import type { StageTiming } from './stage-timing'
export const PROFILE_POLICY = { warmups: 2, samples: 8, historyCycles: 3, historyWarmFrames: 2 } as const
export type ProfileSettings = { fixture: Fixture; count: number; peakCount: number; history: boolean }
export type ProfileCheck = { positions: number; forces: number; cpu: Check; finite: boolean; valid: boolean }
export type ProfileTrial = {
  round: number; warmup: boolean; order: number[]; lane: number; kind: 'normal' | 'profile';
  timing: Measurement; stages?: StageTiming[]; check: ProfileCheck;
}
export type ProfileReport = {
  experiment: string; gpuApi: string; browser: string; settings: ProfileSettings; policy: typeof PROFILE_POLICY;
  tolerance: typeof TOLERANCE; status: 'ready' | 'running' | 'complete' | 'cancelled' | 'failed';
  info: string[]; trials: ProfileTrial[]; error?: string;
  capture?: { positions: number[]; fingerprint: string; tick: number; alpha: number; capacities: number[]; bufferBytes: number[] };
  anchors?: ProfileCheck[]; preparation?: { resizes: number; frames: number; valid: boolean };
  failure?: { positions: number[]; forces: number[]; expectedPositions: number[]; expectedForces: number[] };
}
// Each of the four lane/method combinations occupies each trial position twice
// in the eight ACCEPTED rounds; warmup order never changes that balance.
export function profileOrder (round: number): number[] { return [0, 1, 2, 3].map(i => (i + round) % 4) }
export function fingerprint (points: Float32Array): string {
  let hash = 2166136261
  for (const bits of new Uint32Array(points.buffer, points.byteOffset, points.length)) hash = Math.imul(hash ^ bits, 16777619) >>> 0
  return hash.toString(16).padStart(8, '0')
}
export function profileCheck (actual: Snapshot, expected: Snapshot, cpu: Float32Array): ProfileCheck {
  const positions = differingBits(actual.positions, expected.positions); const forces = differingBits(actual.forces, expected.forces)
  const reference = compareArray(actual.positions, cpu)
  const finite = actual.positions.every(Number.isFinite) && actual.forces.every(Number.isFinite)
  return { positions, forces, cpu: reference, finite, valid: finite && positions === 0 && forces === 0 && reference.valid }
}
export async function createControlledProfiler (settings: ProfileSettings, canvas: (lane: number) => HTMLCanvasElement): Promise<{
  report: ProfileReport; run(options: { cancelled(): boolean; progress(message: string): void }): Promise<void>;
  destroy(): void; remainingBytes(): number[];
}> {
  if (![settings.count, settings.peakCount].every(n => Number.isInteger(n) && n >= 16 && n <= 8192) || settings.count > settings.peakCount) {
    throw new Error('Profile counts must be 16–8192, with logical count within peak count')
  }
  const startCount = settings.history ? Math.max(16, Math.floor(settings.peakCount / 4)) : settings.count
  const session = await createCapacitySession({ fixture: settings.fixture, count: startCount, decay: 100, springPrecision: 'trig' }, canvas, 'reuse')
  const report: ProfileReport = {
    experiment: 'gpu-stage-profile',
    gpuApi: 'luma',
    browser: navigator.userAgent,
    settings,
    policy: PROFILE_POLICY,
    tolerance: TOLERANCE,
    status: 'ready',
    info: session.lanes.map(l => l.info),
    trials: [],
  }
  let started = false
  return {
    report,
    async run ({ cancelled, progress }): Promise<void> {
      if (started) throw new Error('Profiler already started')
      started = true; report.status = 'running'
      const stop = (): boolean => { if (!cancelled()) return false; report.status = 'cancelled'; return true }
      try {
        session.patch(0, new Float32Array([-32, 16, 1, 0])); session.absent(1, true)
        if (settings.history) {
          const cycle = [settings.peakCount, Math.max(16, Math.floor(settings.peakCount / 2)), settings.peakCount, startCount]
          for (let repeat = 0; repeat < PROFILE_POLICY.historyCycles; repeat++) {
            for (const count of cycle) {
              if (stop()) return
              progress(`Preparing resize history ${repeat + 1}/${PROFILE_POLICY.historyCycles} · ${count.toLocaleString()} points`)
              if (!(await session.resize(count)).valid || !(await session.step(true)).valid) throw new Error('Resize-history validation failed')
            }
          }
          if (stop()) return
          if (!(await session.resize(settings.count)).valid) throw new Error('Final logical-count change failed')
          for (let i = 0; i < PROFILE_POLICY.historyWarmFrames; i++) {
            if (stop()) return
            if (!(await session.step(true)).valid) throw new Error('Capture warmup validation failed')
          }
        }
        report.preparation = {
          resizes: session.resizes.length,
          frames: session.rows.length,
          valid: session.resizes.every(r => r.valid) && session.rows.every(r => r.valid),
        }
        const frozen = (await session.lanes[0].backend.read()).positions
        if (differingBits(frozen, (await session.lanes[1].backend.read()).positions)) throw new Error('Capture lanes differ')
        const tick = session.tick(); const alpha = session.alpha(); const view = fitView([frozen])
        report.capture = {
          positions: Array.from(frozen),
          fingerprint: fingerprint(frozen),
          tick,
          alpha,
          capacities: session.lanes.map(l => l.capacity),
          bufferBytes: session.lanes.map(l => l.footprint().bytes),
        }
        const cpu = createOracle(session.lanes[0].data.graph, session.lanes[0].data.input).tick(frozen, alpha, tick)
        const expected: Snapshot[] = []; report.anchors = []
        const failure = (actual: Snapshot, expected: Snapshot): void => {
          report.failure ??= {
            positions: Array.from(actual.positions),
            forces: Array.from(actual.forces),
            expectedPositions: Array.from(expected.positions),
            expectedForces: Array.from(expected.forces),
          }
        }
        for (const [i, lane] of session.lanes.entries()) {
          if (stop()) return
          lane.backend.setPositions(frozen)
          const { snapshot } = await lane.backend.measureCurrentFrame!(alpha, tick, view)
          const anchor = expected[0] ?? snapshot; const check = profileCheck(snapshot, anchor, cpu)
          report.anchors.push(check); expected.push(snapshot)
          if (!check.valid) { failure(snapshot, anchor); throw new Error(`Frozen-input CPU/anchor check failed in lane ${i}`) }
        }
        const methods = [{ lane: 0, kind: 'normal' }, { lane: 1, kind: 'normal' },
          { lane: 0, kind: 'profile' }, { lane: 1, kind: 'profile' }] as const
        for (const warmup of [true, false]) {
          const rounds = warmup ? PROFILE_POLICY.warmups : PROFILE_POLICY.samples
          for (let round = 0; round < rounds; round++) {
            const order = profileOrder(round)
            for (const index of order) {
              if (stop()) return
              const { lane, kind } = methods[index]; const backend = session.lanes[lane].backend
              progress(`${warmup ? 'Warmup' : 'Sample'} ${round + 1}/${rounds} · ${lane ? 'retained' : 'rebuild'} · ${kind}`)
              // Reset writes and their completion fence precede the measured
              // region in BOTH methods. Alpha, seed and camera never advance.
              backend.setPositions(frozen)
              const result: { timing: Measurement; snapshot: Snapshot; stages?: StageTiming[] } = kind === 'profile'
                ? await backend.profileCurrentFrame!(alpha, tick, view)
                : await backend.measureCurrentFrame!(alpha, tick, view)
              const check = profileCheck(result.snapshot, expected[lane], cpu)
              report.trials.push({
                round,
                warmup,
                order,
                lane,
                kind,
                timing: result.timing,
                stages: result.stages,
                check,
              })
              if (!check.valid) { failure(result.snapshot, expected[lane]); throw new Error(`Profile replay failed: ${JSON.stringify(check)}`) }
              await new Promise(resolve => setTimeout(resolve, 0))
            }
          }
        }
        report.status = 'complete'
      } catch (error) { report.status = 'failed'; report.error = String(error) } finally {
        report.preparation = {
          resizes: session.resizes.length,
          frames: session.rows.length,
          valid: session.resizes.every(r => r.valid) && session.rows.every(r => r.valid),
        }
      }
    },
    destroy: () => session.destroy(),
    remainingBytes: () => session.lanes.map(l => l.footprint().bytes),
  }
}
export type ControlledProfiler = Awaited<ReturnType<typeof createControlledProfiler>>
export function profileSummary (report: ProfileReport, lane: number, kind: ProfileTrial['kind'], stage?: string): {
  samples: number; gpuMs: number | null; range: [number, number] | null;
} {
  const trials = report.trials.filter(t => !t.warmup && t.lane === lane && t.kind === kind)
  const values = trials.map(t => stage ? t.stages?.find(s => s.name === stage)?.gpuMs : t.timing.batchGpuMs)
  const valid = trials.length === PROFILE_POLICY.samples && trials.every(t => t.check.valid && t.timing.timerStatus === 'valid') &&
    values.every(n => n !== undefined && n !== null && Number.isFinite(n) && n >= 0)
  if (!valid) return { samples: trials.length, gpuMs: null, range: null }
  const sorted = [...values as number[]].sort((a, b) => a - b); const n = sorted.length / 2
  return { samples: sorted.length, gpuMs: (sorted[n - 1] + sorted[n]) / 2, range: [sorted[0], sorted.at(-1)!] }
}
