import { integrate } from '../many-body-grid/reference'
import { compareArray, type Snapshot } from '../many-body/reference'
import { SETTINGS, type AttractorInput } from './data'
const f = Math.fround
export function reference (input: AttractorInput, points = input.points, settings = SETTINGS): Snapshot {
  const n = points.length / 4; const forces = new Float32Array(points.length)
  // Read raw channels independently; do not consume the adapter's packed texture/buffer.
  const targets = input.targets?.length === n * 2 ? input.targets : undefined
  const strengths = input.strengths?.length === n ? input.strengths : undefined
  let active = false
  for (let i = 0; i < n; i++) {
    const x = targets?.[i * 2]; const y = targets?.[i * 2 + 1]; const p = i * 4
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue
    active = true
    if (points[p + 3] > 0.5) continue
    const rawStrength = strengths?.[i]
    const strength = rawStrength === undefined || !Number.isFinite(rawStrength) ? 1 : rawStrength
    const dx = f(x - points[p]); const dy = f(y - points[p + 1])
    const distance = f(Math.sqrt(f(f(dx * dx) + f(dy * dy))))
    if (distance > 0) {
      const magnitude = f(f(f(f(settings.alpha) * distance) * f(settings.strength)) * strength)
      forces[p] = f(magnitude * f(dx / distance)); forces[p + 1] = f(magnitude * f(dy / distance))
    }
  }
  // Production skips the entire stage when no point has a finite target.
  return { forces, positions: active ? integrate(points, forces, settings) : points.slice() }
}
export function compare (actual: Snapshot, expected: Snapshot, input: Float32Array): {
  valid: boolean; forces: ReturnType<typeof compareArray>; positions: ReturnType<typeof compareArray>;
} {
  const forces = actual.forces.slice(); const referenceForces = expected.forces.slice()
  // Unused forces of absent points do not participate. Their positions/flags still must match.
  for (let i = 0; i < input.length; i += 4) if (input[i + 3] > 0.5) { forces.fill(0, i, i + 4); referenceForces.fill(0, i, i + 4) }
  const checks = { forces: compareArray(forces, referenceForces), positions: compareArray(actual.positions, expected.positions, input) }
  return { ...checks, valid: checks.forces.valid && checks.positions.valid }
}
