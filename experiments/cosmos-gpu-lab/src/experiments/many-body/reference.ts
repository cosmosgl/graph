import { nearLimit, type Input, type Parameters } from './data'
export type Snapshot = { forces: Float32Array; positions: Float32Array }
// Fixed before GPU evaluation: operation-rounding reference, not bitwise identity.
export const TOLERANCE = { absolute: 2e-5, relative: 3e-5 }
const f = Math.fround

export function referenceTick (input: Input, positions: Float32Array, p: Parameters): Snapshot {
  const count = positions.length / 4
  const forces = new Float32Array(positions.length)
  const output = positions.slice()
  const limit = nearLimit(count, p); const radius2 = f(limit * limit)
  for (let i = 0; i < count; i++) {
    if (positions[i * 4 + 3] > 0.5) continue
    const x = positions[i * 4]; const y = positions[i * 4 + 1]
    const rx = input.samples[i * 2]; const ry = input.samples[i * 2 + 1]
    let nx = 0; let ny = 0; let fx = 0; let fy = 0
    for (let j = 0; j < count; j++) {
      if (i === j || positions[j * 4 + 3] > 0.5) continue
      let dx = f(x - positions[j * 4]); let dy = f(y - positions[j * 4 + 1])
      const distance2 = f(f(dx * dx) + f(dy * dy))
      let length2 = distance2
      if (length2 <= 0) { dx = rx; dy = ry; length2 = f(f(dx * dx) + f(dy * dy)) }
      if (length2 <= 0) continue
      const directionLength = f(Math.sqrt(length2))
      const softened = length2 < 1 ? f(Math.sqrt(length2)) : length2
      const magnitude = f(f(f(p.alpha) * f(p.repulsion)) / f(Math.sqrt(softened)))
      const vx = f(magnitude * f(dx / directionLength)); const vy = f(magnitude * f(dy / directionLength))
      if (distance2 < radius2) { nx = f(nx + vx); ny = f(ny + vy) } else { fx = f(fx + vx); fy = f(fy + vy) }
    }
    nx = f(nx + f(nx * rx)); ny = f(ny + f(ny * ry))
    const speed = f(Math.sqrt(f(f(nx * nx) + f(ny * ny))))
    if (speed > limit) { const scale = f(limit / speed); nx = f(nx * scale); ny = f(ny * scale) }
    const vx = f(fx + nx); const vy = f(fy + ny)
    forces[i * 4] = vx; forces[i * 4 + 1] = vy
    if (positions[i * 4 + 2] > 0.5 || !Number.isFinite(vx) || !Number.isFinite(vy)) continue
    // Independent scalar implementation of the production integrator's length bound.
    const dx = f(vx * f(p.friction)); const dy = f(vy * f(p.friction))
    const length = Math.hypot(dx, dy)
    output[i * 4] = f(x + (length > p.referenceLength ? dx / length * p.referenceLength : dx))
    output[i * 4 + 1] = f(y + (length > p.referenceLength ? dy / length * p.referenceLength : dy))
  }
  return { forces, positions: output }
}
export type Check = { valid: boolean; failures: number; maxError: number; worstIndex: number }
export function compareArray (actual: Float32Array, expected: Float32Array, absence?: Float32Array): Check {
  let failures = 0; let maxError = 0; let worstIndex = -1
  if (actual.length !== expected.length) return { valid: false, failures: 1, maxError: Infinity, worstIndex: -1 }
  for (const [i, element] of expected.entries()) {
    // Only an explicitly absent coordinate may preserve a NaN sentinel.
    if (i % 4 < 2 && (absence?.[Math.floor(i / 4) * 4 + 3] ?? 0) > 0.5 && Number.isNaN(element) && Number.isNaN(actual[i])) continue
    const error = Math.abs(actual[i] - element)
    const finiteError = Number.isFinite(error) ? error : Infinity
    if (finiteError > maxError) { maxError = finiteError; worstIndex = i }
    const tolerance = i % 4 >= 2 ? 0 : TOLERANCE.absolute + TOLERANCE.relative * Math.abs(element)
    if (!Number.isFinite(error) || error > tolerance) failures++
  }
  return { valid: failures === 0, failures, maxError, worstIndex }
}
export function compare (actual: Snapshot, expected: Snapshot): { forces: Check; positions: Check; valid: boolean } {
  const forces = compareArray(actual.forces, expected.forces)
  const positions = compareArray(actual.positions, expected.positions, expected.positions)
  return { forces, positions, valid: forces.valid && positions.valid }
}
