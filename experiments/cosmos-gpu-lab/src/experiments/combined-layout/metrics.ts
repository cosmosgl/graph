import type { GraphInput } from '../weighted-links/data'
import { displacement, shape } from '../repulsion-trajectories/metrics'
import { SPRINGS } from './data'
export function metrics (points: Float32Array, previous: Float32Array, graph: GraphInput): {
  motion: ReturnType<typeof displacement>; shape: ReturnType<typeof shape>; linkError: number;
} {
  let squared = 0; let edges = 0
  for (let e = 0; e < graph.links.length; e += 2) {
    const a = graph.links[e] * 4; const b = graph.links[e + 1] * 4
    if (points[a + 3] > 0.5 || points[b + 3] > 0.5) continue
    const length = Math.hypot(points[a] - points[b], points[a + 1] - points[b + 1])
    squared += ((length - SPRINGS.distance) / SPRINGS.distance) ** 2; edges++
  }
  return { motion: displacement(points, previous), shape: shape(points), linkError: edges ? Math.sqrt(squared / edges) : 0 }
}
