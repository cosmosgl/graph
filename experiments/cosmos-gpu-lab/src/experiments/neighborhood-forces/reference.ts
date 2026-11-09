import { createGridPositions, type PointDistribution } from '../spatial-grid/reference'

export type Distribution = PointDistribution | 'boundary'
export type ForceParameters = {
  radius: number;
  strength: number;
  dt: number;
  damping: number;
}

export const DEFAULT_PARAMETERS: ForceParameters = {
  radius: 0.08,
  strength: 0.12,
  dt: 1 / 60,
  damping: 0.95,
}
export const BRUTE_LIMIT = 4096
export const MAX_POINTS = 65536

export function createPositions (count: number, distribution: Distribution, density = 1): Float32Array {
  if (!(density >= 1 && density <= 16)) throw new Error('Density multiplier must be between 1 and 16')
  const positions = createGridPositions(count, distribution === 'boundary' ? 'uniform' : distribution)
  const scale = 1 / Math.sqrt(density)
  for (let index = 0; index < positions.length; index += 1) positions[index] *= scale
  if (distribution === 'boundary') {
    // Exact walls, cell boundaries, coincident pairs and isolated points.
    const special = [-1, -1, 1, 1, 0, 0, 0, 0, -0.00001, 0, 0.00001, 0, -1, 0, 1, 0]
    positions.set(special.slice(0, positions.length))
  }
  return positions
}

export function forceAt (positions: Float32Array, index: number, parameters: ForceParameters): number[] {
  let fx = 0
  let fy = 0
  let neighbors = 0
  const radius = Math.fround(parameters.radius)
  const radiusSquared = Math.fround(radius * radius)
  for (let other = 0; other < positions.length / 2; other += 1) {
    if (other === index) continue
    const dx = Math.fround(positions[index * 2] - positions[other * 2])
    const dy = Math.fround(positions[index * 2 + 1] - positions[other * 2 + 1])
    const squared = Math.fround(Math.fround(dx * dx) + Math.fround(dy * dy))
    if (squared >= radiusSquared) continue
    neighbors += 1
    const distance = Math.sqrt(squared)
    if (distance <= 1e-6) {
      fx += index < other ? -1 : 1
    } else {
      const weight = (1 - distance / radius) / distance
      fx += dx * weight
      fy += dy * weight
    }
  }
  return [fx * parameters.strength, fy * parameters.strength, neighbors]
}

export function integratePoint (
  position: number[], velocity: number[], force: number[], parameters: ForceParameters
): { position: number[]; velocity: number[] } {
  const magnitude = Math.hypot(force[0], force[1])
  const factor = magnitude > 10 ? 10 / magnitude : 1
  const nextVelocity = velocity.map((value, axis) =>
    (value + force[axis] * factor * parameters.dt) * parameters.damping)
  const speed = Math.hypot(...nextVelocity)
  if (speed > 0.5) for (let axis = 0; axis < 2; axis += 1) nextVelocity[axis] *= 0.5 / speed
  const nextPosition = position.map((value, axis) => value + nextVelocity[axis] * parameters.dt)
  for (let axis = 0; axis < 2; axis += 1) {
    if (nextPosition[axis] < -1 || nextPosition[axis] > 1) {
      nextPosition[axis] = Math.max(-1, Math.min(1, nextPosition[axis]))
      nextVelocity[axis] *= -0.5
    }
  }
  return { position: nextPosition, velocity: nextVelocity }
}

export type Validation = {
  valid: boolean;
  checked: number;
  total: number;
  neighborMismatches: number;
  neighborMismatchDetails: Array<{ index: number; expected: number; actual: number }>;
  forceFailures: number;
  nonFinite: number;
  maximumForceError: number;
  maximumPositionError: number;
  maximumVelocityError: number;
  meanCandidates: number;
  meanNeighbors: number;
  worstForce: { index: number; expected: number[]; actual: number[]; error: number; tolerance: number; ratio: number } | null;
  accumulationDiagnostic?: {
    serial: number[]; double: number[]; blocked: number[];
    serialError: number; doubleError: number; blockedError: number; serialToGpuError: number;
    neighbors: number;
  };
}

export function validateStep (
  positions: Float32Array, velocities: Float32Array, forces: Float32Array,
  nextPositions: Float32Array, nextVelocities: Float32Array, parameters: ForceParameters, sampleCount = 128
): Validation {
  const total = positions.length / 2
  if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error('Sample count must be a positive integer')
  // A deeper check must retain every baseline point from the original 128-point validation.
  const selected = new Set<number>()
  if (total <= 1024) {
    for (let index = 0; index < total; index += 1) selected.add(index)
  } else {
    for (const requested of [128, sampleCount]) {
      const count = Math.min(total, requested)
      for (let sample = 0; sample < count; sample += 1) selected.add(Math.floor(sample * (total - 1) / Math.max(1, count - 1)))
    }
  }
  const checked = selected.size
  const result: Validation = {
    valid: true,
    checked,
    total,
    neighborMismatches: 0,
    neighborMismatchDetails: [],
    forceFailures: 0,
    nonFinite: 0,
    maximumForceError: 0,
    maximumPositionError: 0,
    maximumVelocityError: 0,
    meanCandidates: 0,
    meanNeighbors: 0,
    worstForce: null,
  }
  for (const array of [positions, velocities, forces, nextPositions, nextVelocities]) {
    for (const value of array) if (!Number.isFinite(value)) result.nonFinite += 1
  }
  for (const index of selected) {
    const expected = forceAt(positions, index, parameters)
    if (expected[2] !== forces[index * 4 + 2]) {
      result.neighborMismatches += 1
      if (result.neighborMismatchDetails.length < 8) {
        result.neighborMismatchDetails.push({ index, expected: expected[2], actual: forces[index * 4 + 2] })
      }
    }
    const error = Math.hypot(expected[0] - forces[index * 4], expected[1] - forces[index * 4 + 1])
    // Scatter order is nondeterministic: compare float sums with a mixed tolerance.
    const tolerance = 0.0002 + 0.0002 * Math.hypot(expected[0], expected[1])
    if (error > tolerance) result.forceFailures += 1
    const ratio = error / tolerance
    if (!result.worstForce || ratio > result.worstForce.ratio) {
      result.worstForce = {
        index,
        expected: expected.slice(0, 2),
        actual: Array.from(forces.subarray(index * 4, index * 4 + 2)),
        error,
        tolerance,
        ratio,
      }
    }
    result.maximumForceError = Math.max(result.maximumForceError, error)
    const integrated = integratePoint(
      Array.from(positions.subarray(index * 2, index * 2 + 2)),
      Array.from(velocities.subarray(index * 2, index * 2 + 2)), expected, parameters
    )
    result.maximumPositionError = Math.max(result.maximumPositionError, Math.hypot(
      integrated.position[0] - nextPositions[index * 2], integrated.position[1] - nextPositions[index * 2 + 1]))
    result.maximumVelocityError = Math.max(result.maximumVelocityError, Math.hypot(
      integrated.velocity[0] - nextVelocities[index * 2], integrated.velocity[1] - nextVelocities[index * 2 + 1]))
  }
  for (let index = 0; index < total; index += 1) {
    result.meanCandidates += forces[index * 4 + 3] / total
    result.meanNeighbors += forces[index * 4 + 2] / total
  }
  result.valid = result.neighborMismatches === 0 && result.forceFailures === 0 && result.nonFinite === 0 &&
    result.maximumPositionError < 0.00005 && result.maximumVelocityError < 0.00005
  return result
}
