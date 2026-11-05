import type { ReductionBenchmark, ReductionCenter } from '../scalable-reduction/backend'

export type SimulationBenchmarkBackend = {
  benchmark: (iterations: number) => Promise<ReductionBenchmark>;
  readCenter: () => Promise<ReductionCenter>;
  destroy: () => void;
}

export type SampleSummary = {
  p50: number;
  p95: number;
  minimum: number;
  maximum: number;
}

export function summarizeSamples (samples: number[]): SampleSummary {
  const sorted = [...samples].sort((left, right) => left - right)
  const percentile = (value: number): number => {
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)
    return sorted[Math.max(0, index)]
  }
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    minimum: sorted[0] ?? 0,
    maximum: sorted[sorted.length - 1] ?? 0,
  }
}
