import { distanceSample, validIndex, type GraphInput } from '../weighted-links/data'
import { displacement, shape } from '../repulsion-trajectories/metrics'
import { SPRINGS } from '../combined-layout/data'
import type { ForceSettings } from '../combined-layout/production-settings'
import type { View } from '../many-body/backend'
export type Pair = { a: number; b: number; distance: number }
export function stressPairs (graph: GraphInput): { pairs: Pair[]; landmarks: number[]; unreachable: number } {
  const n = graph.points.length / 4
  const present = Array.from({ length: n }, (_, i) => i).filter(i => graph.points[i * 4 + 3] <= 0.5)
  const neighbors: number[][] = Array.from({ length: n }, () => [])
  for (let e = 0; e < graph.links.length; e += 2) {
    const a = graph.links[e]; const b = graph.links[e + 1]
    if (validIndex(a, n) && validIndex(b, n) && a !== b && graph.points[a * 4 + 3] <= 0.5 && graph.points[b * 4 + 3] <= 0.5) {
      neighbors[a].push(b); neighbors[b].push(a)
    }
  }
  const k = Math.min(present.length, n <= 128 ? n : 16)
  const landmarks = Array.from({ length: k }, (_, i) => present[Math.floor(i * present.length / k)])
  const chosen = new Set(landmarks); const pairs: Pair[] = []; let unreachable = 0
  for (const a of landmarks) {
    const distances = new Int32Array(n).fill(-1); distances[a] = 0
    const queue = [a]
    for (let q = 0; q < queue.length; q++) {
      const current = queue[q]
      for (const b of neighbors[current]) if (distances[b] < 0) { distances[b] = distances[current] + 1; queue.push(b) }
    }
    for (const b of present) {
      if (a === b || (chosen.has(b) && b < a)) continue
      if (distances[b] < 0) unreachable++
      else pairs.push({ a, b, distance: distances[b] })
    }
  }
  return { pairs, landmarks, unreachable }
}
export function stress (points: Float32Array, pairs: Pair[]): { rms: number | null; fittedScale: number | null } {
  if (!pairs.length) return { rms: null, fittedScale: null }
  const q = pairs.map(({ a, b, distance }) => Math.hypot(points[a * 4] - points[b * 4], points[a * 4 + 1] - points[b * 4 + 1]) / distance)
  const sum = q.reduce((a, b) => a + b, 0); const squared = q.reduce((a, b) => a + b * b, 0)
  if (!squared) return { rms: 1, fittedScale: null }
  const fittedScale = sum / squared
  return { rms: Math.sqrt(q.reduce((s, v) => s + (fittedScale * v - 1) ** 2, 0) / q.length), fittedScale }
}
export function alignedDrift (points: Float32Array, reference: Float32Array): number {
  if (points.length !== reference.length) throw new Error('Position lengths differ')
  const a = shape(points); const b = shape(reference)
  let dot = 0; let cross = 0
  for (let i = 0; i < points.length; i += 4) {
    if (reference[i + 3] > 0.5) continue
    const x = points[i] - a.center[0]; const y = points[i + 1] - a.center[1]
    const u = reference[i] - b.center[0]; const v = reference[i + 1] - b.center[1]
    dot += x * u + y * v; cross += x * v - y * u
  }
  const angle = Math.atan2(cross, dot); const c = Math.cos(angle); const s = Math.sin(angle)
  let sum = 0
  for (let i = 0; i < points.length; i += 4) {
    if (reference[i + 3] > 0.5) continue
    const x = points[i] - a.center[0]; const y = points[i + 1] - a.center[1]
    sum += (x * c - y * s - reference[i] + b.center[0]) ** 2 + (x * s + y * c - reference[i + 1] + b.center[1]) ** 2
  }
  return b.present ? Math.sqrt(sum / b.present) : 0
}
export function springMismatch (points: Float32Array, graph: GraphInput, settings: ForceSettings): number | null {
  const f = Math.fround; let sum = 0; let count = 0; const n = points.length / 4
  for (let e = 0; e < graph.links.length / 2; e++) {
    const a = graph.links[e * 2]; const b = graph.links[e * 2 + 1]
    if (!validIndex(a, n) || !validIndex(b, n) || points[a * 4 + 3] > 0.5 || points[b * 4 + 3] > 0.5) continue
    const length = Math.hypot(points[a * 4] - points[b * 4], points[a * 4 + 1] - points[b * 4 + 1])
    for (let side = 0; side < 2; side++) {
      const variation = f(f(distanceSample(e, side) * f(f(settings.variation[1]) - f(settings.variation[0]))) + f(settings.variation[0]))
      const rest = f(variation * f(SPRINGS.distance))
      sum += ((length - rest) / rest) ** 2; count++
    }
  }
  return count ? Math.sqrt(sum / count) : null
}
export function quality (points: Float32Array, before: Float32Array, cpu: Float32Array, graph: GraphInput, settings: ForceSettings, pairs: Pair[]): {
  shape: ReturnType<typeof shape>; motion: ReturnType<typeof displacement>; normalizedMotion: number | null;
  stress: ReturnType<typeof stress>; springMismatch: number | null; drift: ReturnType<typeof displacement>; alignedRms: number;
} {
  const geometry = shape(points); const motion = displacement(points, before)
  return {
    shape: geometry,
    motion,
    normalizedMotion: geometry.radius ? motion.rms / geometry.radius : null,
    stress: stress(points, pairs),
    springMismatch: springMismatch(points, graph, settings),
    drift: displacement(points, cpu),
    alignedRms: alignedDrift(points, cpu),
  }
}
export function sharedView (lanes: Float32Array[]): View {
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity
  for (const points of lanes) {
    for (let i = 0; i < points.length; i += 4) {
      if (points[i + 3] > 0.5 || !Number.isFinite(points[i]) || !Number.isFinite(points[i + 1])) continue
      x0 = Math.min(x0, points[i]); x1 = Math.max(x1, points[i]); y0 = Math.min(y0, points[i + 1]); y1 = Math.max(y1, points[i + 1])
    }
  }
  if (!Number.isFinite(x0)) return [0, 0, 1 / 16, 1 / 16]
  const half = Math.max(16, (y1 - y0) / 2, (x1 - x0) / 2 / (480 / 340)) * 1.1
  return [(x0 + x1) / 2, (y0 + y1) / 2, 1 / (half * 480 / 340), 1 / half]
}
