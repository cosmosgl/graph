import { integrate } from '../many-body-grid/reference'
import { compareArray, type Snapshot } from '../many-body/reference'
import { MIN_DISTANCE, pointerUniform, SETTINGS, type Vector } from './data'

export function mouseReference (positions: Float32Array, world: Vector, strength: number, settings = SETTINGS): Snapshot {
  const [x, y, repulsion] = pointerUniform(world, strength)
  const forces = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i += 4) {
    if (positions[i + 3] > 0.5) continue
    const dx = positions[i] - x
    const dy = positions[i + 1] - y
    const distance = Math.hypot(dx, dy)
    if (distance === 0) continue
    const boundedDistance = Math.max(distance, MIN_DISTANCE)
    const magnitude = 100 * repulsion / boundedDistance ** 2
    forces[i] = magnitude * dx / distance
    forces[i + 1] = magnitude * dy / distance
  }
  return { forces, positions: integrate(positions, forces, settings) }
}

export function compareMouse (actual: Snapshot, expected: Snapshot, before: Float32Array, world: Vector, legacy = false): {
  valid: boolean; forces: ReturnType<typeof compareArray>; positions: ReturnType<typeof compareArray>; fixedFailures: number;
  coincident: number;
} {
  const actualForces = actual.forces.slice()
  const expectedForces = expected.forces.slice()
  const expectedPositions = expected.positions.slice()
  const [x, y] = pointerUniform(world, 0)
  let fixedFailures = 0
  let coincident = 0
  for (let i = 0; i < before.length; i += 4) {
    const absent = before[i + 3] > 0.5
    const pinned = before[i + 2] > 0.5
    if ((pinned || absent) && (!Object.is(actual.positions[i], before[i]) || !Object.is(actual.positions[i + 1], before[i + 1]))) fixedFailures++
    if (absent || (legacy && before[i] === x && before[i + 1] === y)) {
      actualForces.fill(0, i, i + 4)
      expectedForces.fill(0, i, i + 4)
      if (!absent) {
        coincident++
        expectedPositions.set(actual.positions.subarray(i, i + 2), i)
      }
    }
  }
  const forces = compareArray(actualForces, expectedForces)
  const positions = compareArray(actual.positions, expectedPositions, before)
  return { forces, positions, fixedFailures, coincident, valid: forces.valid && positions.valid && fixedFailures === 0 }
}
