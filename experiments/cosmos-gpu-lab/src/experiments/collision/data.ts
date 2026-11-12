import { createFixture as pointFixture, type Input } from '../many-body/data'
import type { GraphInput } from '../weighted-links/data'
import type { CenterReduction } from '../combined-layout/center-reduction'
export type CollisionParameters = { strength: number; radius: number; padding: number; iterations: number; cooling: number }
// Distance/accumulation are diagnostic ablations, rather than accepted kernels.
export const COLLISION_ARITHMETICS = ['native', 'targeted', 'distance', 'accumulation', 'strict'] as const
export type CollisionArithmetic = typeof COLLISION_ARITHMETICS[number]
export const DEFAULT_COLLISION_ARITHMETIC: CollisionArithmetic = 'targeted'
export const COLLISION: CollisionParameters = { strength: 1, radius: 0, padding: 0.25, iterations: 1, cooling: 0 }
export const FIXTURES = ['pair', 'uniform', 'clusters', 'coincident', 'masks', 'separated'] as const
export type Fixture = typeof FIXTURES[number]
export const TOPOLOGIES = ['chain', 'communities', 'star'] as const
export type Topology = typeof TOPOLOGIES[number]
export type Settings = {
  fixture: Fixture; count: number; mode: 'collision' | 'combined'; alpha: number; collision: CollisionParameters;
  arithmetic?: CollisionArithmetic; centerReduction?: CenterReduction;
  evolution?: 'shared' | 'independent'; topology?: Topology; coolingTicks?: number;
}
export function validateCollision (p: CollisionParameters): void {
  if (![p.strength, p.radius, p.padding, p.cooling].every(v => Number.isFinite(v) && v >= 0) || p.strength > 1 ||
    !Number.isInteger(p.iterations) || p.iterations < 1 || p.iterations > 8) throw new Error('Invalid collision parameters')
}
export function validateSizes (sizes: Float32Array, count: number): void {
  if (sizes.length !== count || count > 4096 || !sizes.every(v => Number.isFinite(v) && v >= 0)) {
    throw new Error('Exact collision requires 0–4096 points and finite nonnegative sizes')
  }
}
export function radius (size: number, p: CollisionParameters): number {
  return Math.fround((p.radius > 0 ? Math.fround(p.radius) : Math.fround(size * 0.5)) + Math.fround(p.padding))
}
export function maxRadius (sizes: Float32Array, p: CollisionParameters): number {
  return Math.fround((p.radius > 0 ? p.radius : Math.max(0, ...sizes) * 0.5) + p.padding)
}
export function createFixture (fixture: Fixture, requested = 128, topology: Topology = 'chain'): { input: Input; graph: GraphInput } {
  if (!FIXTURES.includes(fixture) || !Number.isInteger(requested) || requested < 2 || requested > 4096) throw new Error('Invalid collision fixture')
  if (!TOPOLOGIES.includes(topology)) throw new Error('Invalid collision topology')
  const count = fixture === 'pair' ? 2 : fixture === 'masks' ? 8 : requested
  const input = pointFixture('uniform', count); const sizes = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    sizes[i] = 4 + (i % 5) * 2
    const offset = i * 4; const x = input.points[offset]; const y = input.points[offset + 1]
    input.points[offset] = 2048 + (fixture === 'coincident'
      ? 0
      : fixture === 'clusters'
        ? (i % 2 ? 12 : -12) + x / 20
        : fixture === 'separated' ? (i % Math.ceil(Math.sqrt(count))) * 24 : x)
    input.points[offset + 1] = 2048 + (fixture === 'coincident'
      ? 0
      : fixture === 'clusters'
        ? y / 20
        : fixture === 'separated' ? Math.floor(i / Math.ceil(Math.sqrt(count))) * 24 : y)
  }
  if (fixture === 'pair') { input.points.set([2045, 2048, 0, 0, 2051, 2048, 0, 0]); sizes.set([8, 16]) }
  if (fixture === 'masks') {
    input.points.set([
      2048, 2048, 1, 0, 2049, 2048, 0, 0, NaN, NaN, 0, 1, 2048, 2048, 0, 1,
      2050, 2049, 0, 0, 2048, 2048, 0, 0, 2048, 2048, 1, 0, 2090, 2048, 0, 0,
    ])
  }
  const edges: number[] = []
  for (let i = 1; i < count; i++) {
    if (topology === 'star') edges.push(0, i)
    else {
      edges.push(i - 1, i)
      if (topology === 'communities' && i % 16 > 1) edges.push(Math.floor(i / 16) * 16, i)
    }
  }
  const links = new Float32Array(edges)
  return { input, graph: { points: input.points, sizes, links, weights: new Float32Array(links.length / 2).fill(1) } }
}
export function overlap (points: Float32Array, sizes: Float32Array, p: CollisionParameters): { pairs: number; pinnedPairs: number; maxPenetration: number } {
  let pairs = 0; let pinnedPairs = 0; let maxPenetration = 0
  for (let a = 0; a < sizes.length; a++) {
    if (points[a * 4 + 3] > 0.5) continue
    for (let b = a + 1; b < sizes.length; b++) {
      if (points[b * 4 + 3] > 0.5) continue
      const depth = radius(sizes[a], p) + radius(sizes[b], p) - Math.hypot(points[a * 4] - points[b * 4], points[a * 4 + 1] - points[b * 4 + 1])
      if (depth > 0) { pairs++; if (points[a * 4 + 2] > 0.5 && points[b * 4 + 2] > 0.5) pinnedPairs++; maxPenetration = Math.max(maxPenetration, depth) }
    }
  }
  return { pairs, pinnedPairs, maxPenetration }
}
