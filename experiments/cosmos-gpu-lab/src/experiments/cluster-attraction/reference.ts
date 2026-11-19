import { integrate } from '../many-body-grid/reference'
import { compareArray, type Snapshot } from '../many-body/reference'
import { SETTINGS, type ClusterInput } from './data'
const f = Math.fround
export type ClusterSnapshot = Snapshot & { aggregates: Float32Array }
export function reference (input: ClusterInput, points = input.points, settings = SETTINGS): ClusterSnapshot {
  // Independent scalar group sums; does not consume the candidate's grouped index.
  const sums = new Float64Array(input.targets.length)
  for (let i = 0; i < input.membership.length; i++) {
    const group = input.membership[i]; const p = i * 4
    if (group < 0 || points[p + 3] > 0.5) continue
    sums[group * 4] += points[p]; sums[group * 4 + 1] += points[p + 1]; sums[group * 4 + 2]++
  }
  const aggregates = new Float32Array(sums); const forces = new Float32Array(points.length)
  for (let i = 0; i < input.membership.length; i++) {
    const p = i * 4; const group = input.membership[i] * 4
    if (group < 0 || points[p + 3] > 0.5) continue
    const explicit = input.targets[group + 2] > 0.5
    if (!explicit && !aggregates[group + 2]) continue
    const x = explicit ? input.targets[group] : f(aggregates[group] / aggregates[group + 2])
    const y = explicit ? input.targets[group + 1] : f(aggregates[group + 1] / aggregates[group + 2])
    const dx = f(x - points[p]); const dy = f(y - points[p + 1])
    const distance = f(Math.sqrt(f(f(dx * dx) + f(dy * dy))))
    if (distance > 0) {
      const magnitude = f(f(f(f(settings.alpha) * distance) * f(settings.strength)) * input.strengths[i])
      forces[p] = f(magnitude * f(dx / distance)); forces[p + 1] = f(magnitude * f(dy / distance))
    }
  }
  return { aggregates, forces, positions: integrate(points, forces, settings) }
}
export function compare (actual: ClusterSnapshot, expected: ClusterSnapshot, input: Float32Array): {
  valid: boolean; aggregates: ReturnType<typeof compareArray>; forces: ReturnType<typeof compareArray>; positions: ReturnType<typeof compareArray>;
} {
  const forces = actual.forces.slice(); const referenceForces = expected.forces.slice()
  // Production computes unused forces for absent points. Integration must preserve them.
  for (let i = 0; i < input.length; i += 4) if (input[i + 3] > 0.5) { forces.fill(0, i, i + 4); referenceForces.fill(0, i, i + 4) }
  const checks = {
    aggregates: compareArray(actual.aggregates, expected.aggregates),
    forces: compareArray(forces, referenceForces),
    positions: compareArray(actual.positions, expected.positions, input),
  }
  return { ...checks, valid: Object.values(checks).every(c => c.valid) }
}
