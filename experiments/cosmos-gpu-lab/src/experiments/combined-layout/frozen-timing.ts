import type { Measurement } from '../many-body/timing'
import type { StageTiming } from './stage-timing'
import type { ProfileCheck, ProfileTrial } from './controlled-profile'
export const FROZEN_POLICY = { warmups: 4, samples: 12, frames: 4, diagnostics: false, batched: true } as const
export type FrozenPolicy = { warmups: number; samples: number; frames: number; diagnostics?: boolean; batched?: boolean }
export type FrozenFrame = { timing?: Measurement; gpuMs?: number | null; stages?: StageTiming[]; check: ProfileCheck }
export type FrozenTrial = ProfileTrial & { frames: FrozenFrame[] }
export function frozenSummary (row: { trials: FrozenTrial[] }, policy: FrozenPolicy, lane: number, kind: ProfileTrial['kind'], stage?: string): {
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

export function frozenPairedWins (row: { trials: FrozenTrial[] }, policy: FrozenPolicy): number | null {
  if ([0, 1].some(lane => frozenSummary(row, policy, lane, 'normal').median === null)) return null
  const trials = row.trials.filter(t => !t.warmup && t.kind === 'normal')
  return trials.filter(t => t.lane === 0 && trials.find(c => c.lane === 1 && c.round === t.round)!.timing.batchGpuMs! < t.timing.batchGpuMs!).length
}
