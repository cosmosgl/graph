import { distanceSample, validIndex, type GraphInput, type Parameters } from './data'
const f = Math.fround
export type Snapshot = { firstForce: Float32Array; intermediate: Float32Array; secondForce: Float32Array; positions: Float32Array }
// Independent JavaScript lists retain original edge IDs; this never consumes the GPU CSR/properties.
export function createReferenceIndex (graph: GraphInput): {
  degrees: Uint32Array; byPoint: [number[][], number[][]];
} {
  const n = graph.points.length / 4
  const degrees = new Uint32Array(n)
  const byPoint: [number[][], number[][]] = [Array.from({ length: n }, () => []), Array.from({ length: n }, () => [])]
  for (let e = 0; e < graph.links.length / 2; e++) {
    const a = graph.links[2 * e]; const b = graph.links[2 * e + 1]
    if (validIndex(a, n) && validIndex(b, n)) {
      degrees[a]++; degrees[b]++; byPoint[0][a].push(e); byPoint[1][b].push(e)
    }
  }
  return { degrees, byPoint }
}
export function referenceTick (
  graph: GraphInput, input: Float32Array, p: Parameters, index = createReferenceIndex(graph), firstSide: 0 | 1 = 0
): Snapshot {
  const n = input.length / 4
  const { degrees, byPoint } = index
  const direction = (positions: Float32Array, side: number): { force: Float32Array; output: Float32Array } => {
    const force = new Float32Array(input.length)
    const output = positions.slice()
    for (let i = 0; i < n; i++) {
      let vx = 0; let vy = 0
      for (const e of byPoint[side][i]) {
        const j = graph.links[2 * e + 1 - side]
        if (positions[j * 4 + 3] > 0.5) continue
        const weight = graph.weights[e]
        const strength = f(Math.sqrt(Number.isFinite(weight) && weight >= 0 ? weight : 1 / Math.max(Math.min(degrees[i], degrees[j]), 1)))
        const bias = f(degrees[j] / (degrees[i] + degrees[j]))
        let rest = f(f(f(distanceSample(e, side) * f(f(p.variation[1]) - f(p.variation[0]))) + f(p.variation[0])) * f(p.distance))
        if (p.collision) {
          const radius = (index: number): number => f(f(p.radius > 0 ? p.radius : f(graph.sizes[index] * 0.5)) + f(p.padding))
          rest = Math.max(rest, f(radius(i) + radius(j)))
        }
        const x = f(positions[j * 4] - f(positions[i * 4] + vx))
        const y = f(positions[j * 4 + 1] - f(positions[i * 4 + 1] + vy))
        const length = Math.max(f(Math.sqrt(f(f(x * x) + f(y * y)))), f(rest * f(0.99)))
        let scale = f(f(length - rest) / length)
        scale = f(scale * f(f(p.spring) * f(p.alpha))); scale = f(scale * strength); scale = f(scale * bias)
        vx = f(vx + f(x * scale)); vy = f(vy + f(y * scale))
      }
      force[i * 4] = vx; force[i * 4 + 1] = vy
      if (positions[i * 4 + 2] > 0.5 || positions[i * 4 + 3] > 0.5 || !Number.isFinite(vx) || !Number.isFinite(vy)) continue
      let dx = f(vx * f(p.friction)); let dy = f(vy * f(p.friction))
      if (Math.hypot(dx, dy) > p.maxStep) {
        const length = Math.hypot(vx, vy)
        dx = vx / length * Math.sign(p.friction) * p.maxStep
        dy = vy / length * Math.sign(p.friction) * p.maxStep
      }
      output[i * 4] = f(positions[i * 4] + dx); output[i * 4 + 1] = f(positions[i * 4 + 1] + dy)
    }
    return { force, output }
  }
  const a = direction(input, firstSide); const b = direction(a.output, 1 - firstSide)
  return { firstForce: a.force, intermediate: a.output, secondForce: b.force, positions: b.output }
}
export const TOLERANCE = { absolute: 2e-6, relative: 2e-5 }
export function compareArray (a: Float32Array, b: Float32Array): { valid: boolean; failures: number; maxError: number } {
  let failures = 0; let maxError = 0
  if (a.length !== b.length) return { valid: false, failures: 1, maxError: Infinity }
  for (const [i, element] of a.entries()) {
    const error = Math.abs(element - b[i]); maxError = Math.max(maxError, Number.isFinite(error) ? error : Infinity)
    if (!Number.isFinite(error) || error > TOLERANCE.absolute + TOLERANCE.relative * Math.abs(b[i])) failures++
  }
  return { valid: failures === 0, failures, maxError }
}
export function compare (actual: Snapshot, expected: Snapshot): { valid: boolean; failures: number; maxError: number } {
  const checks = (['firstForce', 'intermediate', 'secondForce', 'positions'] as const).map(key => compareArray(actual[key], expected[key]))
  return {
    valid: checks.every(check => check.valid),
    failures: checks.reduce((sum, check) => sum + check.failures, 0),
    maxError: Math.max(...checks.map(check => check.maxError)),
  }
}
