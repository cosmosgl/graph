import { displacement, shape } from '../repulsion-trajectories/metrics'
import { alignedDrift, stress, type Pair } from '../matched-layout/metrics'
export function layoutMetrics (points: Float32Array, before: Float32Array, cpu: Float32Array, pairs: Pair[]): {
  shape: ReturnType<typeof shape>; motion: ReturnType<typeof displacement>; drift: ReturnType<typeof displacement>;
  normalizedDrift: number | null; alignedRms: number; stress: ReturnType<typeof stress>;
} {
  const drift = displacement(points, cpu); const cpuRadius = shape(cpu).radius
  return {
    shape: shape(points),
    motion: displacement(points, before),
    drift,
    normalizedDrift: cpuRadius ? drift.rms / cpuRadius : null,
    alignedRms: alignedDrift(points, cpu),
    stress: stress(points, pairs),
  }
}
