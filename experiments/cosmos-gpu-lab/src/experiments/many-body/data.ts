import { getFinestGridSize } from '../../../../../src/modules/Shared/cell-slots'

export const FIXTURES = ['pair', 'uniform', 'clusters', 'coincident', 'edge-cases', 'boundary'] as const
export type Fixture = typeof FIXTURES[number]
export type Variant = 'direct' | 'tiled'
export type Parameters = { alpha: number; repulsion: number; friction: number; referenceLength: number }
export const PARAMETERS: Parameters = { alpha: 0.6, repulsion: 1, friction: 0.85, referenceLength: 4096 }
export type Input = {
  // x, y, pinned, absent; separate from the two random components in samples.
  points: Float32Array;
  samples: Float32Array;
}
export function nearLimit (count: number, params: Parameters): number {
  return Math.fround(2 * params.referenceLength / getFinestGridSize(count))
}
export function validateInput (input: Input, p: Parameters): void {
  const count = input.points.length / 4
  if (!Number.isInteger(count) || count > 4096 || input.samples.length !== count * 2) throw new Error('Expected 0–4096 points and one sample pair per point')
  if (![p.alpha, p.repulsion, p.friction, p.referenceLength].every(Number.isFinite) ||
    p.alpha < 0 || p.repulsion < 0 || Math.abs(p.friction) > 1 || p.referenceLength <= 0) throw new Error('Invalid force parameters')
  for (let i = 0; i < count; i++) {
    if (![input.points[i * 4 + 2], input.points[i * 4 + 3], input.samples[i * 2], input.samples[i * 2 + 1]].every(Number.isFinite)) {
      throw new Error('Flags and samples must be finite')
    }
    if (input.points[i * 4 + 3] <= 0.5 && ![input.points[i * 4], input.points[i * 4 + 1]].every(Number.isFinite)) {
      throw new Error('Present positions must be finite')
    }
  }
}
export function createFixture (fixture: Fixture, requestedCount = 128, p = PARAMETERS): Input {
  const count = fixture === 'pair' ? 2 : fixture === 'edge-cases' || fixture === 'boundary' ? 8 : requestedCount
  const points = new Float32Array(count * 4)
  const samples = new Float32Array(count * 2)
  let seed = 29471
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < count; i++) {
    const x = random() * 2 - 1; const y = random() * 2 - 1
    points.set(fixture === 'coincident' ? [0, 0] : fixture === 'clusters' ? [(i % 2 ? 24 : -24) + x * 2, y * 2] : [x * 64, y * 64], i * 4)
    // Production generates two independent [-1, 1) draws scaled by 1e-5.
    // This deterministic stream is shared, rather than relying on PRNG call order in Graph.
    samples.set([(random() * 2 - 1) * 1e-5, (random() * 2 - 1) * 1e-5], i * 2)
  }
  if (fixture === 'pair') { points.set([-2, 0, 0, 0, 2, 0, 0, 0]); samples.fill(0) }
  if (fixture === 'edge-cases') {
    points.set([0, 0, 0, 0, 0, 0, 0, 0, 0.25, 0, 0, 0, 8, 0, 1, 0,
      NaN, NaN, 0, 1, 9000, -9000, 0, 1, -0.25, 0, 0, 0, 2048, 2048, 0, 0])
    samples[0] = 0; samples[1] = 0
  }
  if (fixture === 'boundary') {
    const radius = nearLimit(count, p)
    points.set([0, 0, 0, 0, radius, 0, 0, 0, Math.fround(radius * (1 - 2 ** -23)), 0, 0, 0,
      Math.fround(radius * (1 + 2 ** -23)), 0, 0, 0, 1, 0, 0, 0, Math.fround(1 - 2 ** -24), 0, 0, 0,
      Math.fround(1 + 2 ** -23), 0, 0, 0, -radius, 0, 1, 0])
  }
  return { points, samples }
}
