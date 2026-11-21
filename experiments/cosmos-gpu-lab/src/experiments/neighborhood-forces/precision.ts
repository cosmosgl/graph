import type { Validation } from './reference'

// Independent CPU reductions of captured GPU contributions, in the grid's scatter order.
export function diagnoseContributions (values: Float32Array, strength: number, worst: NonNullable<Validation['worstForce']>):
NonNullable<Validation['accumulationDiagnostic']> {
  const ordered = new Float32Array(values.length)
  let length = 0
  for (let i = 0; i < values.length; i += 4) {
    if (values[i + 3] === 1) { ordered.set(values.subarray(i, i + 4), length); length += 4 }
  }
  values = ordered.subarray(0, length)
  const serial = [0, 0]
  const double = [0, 0]
  const blocked = [0, 0]
  let neighbors = 0
  const group = [0, 0]
  let blockCount = 0
  for (let start = 0; start < values.length / 4; start += 64) {
    const partial = [0, 0]
    for (let i = start; i < Math.min(start + 64, values.length / 4); i += 1) {
      neighbors += values[i * 4 + 2]
      for (let axis = 0; axis < 2; axis += 1) {
        const value = values[i * 4 + axis]
        double[axis] += value
        serial[axis] = Math.fround(serial[axis] + value)
        partial[axis] = Math.fround(partial[axis] + value)
      }
    }
    for (let axis = 0; axis < 2; axis += 1) group[axis] = Math.fround(group[axis] + partial[axis])
    blockCount += 1
    if (blockCount === 16) {
      for (let axis = 0; axis < 2; axis += 1) { blocked[axis] = Math.fround(blocked[axis] + group[axis]); group[axis] = 0 }
      blockCount = 0
    }
  }
  for (let axis = 0; axis < 2; axis += 1) blocked[axis] = Math.fround(blocked[axis] + group[axis])
  for (const sum of [serial, blocked]) {
    for (let axis = 0; axis < 2; axis += 1) sum[axis] = Math.fround(sum[axis] * Math.fround(strength))
  }
  for (let axis = 0; axis < 2; axis += 1) double[axis] *= Math.fround(strength)
  const error = (value: number[]): number => Math.hypot(value[0] - worst.expected[0], value[1] - worst.expected[1])
  return {
    serial,
    double,
    blocked,
    neighbors,
    serialError: error(serial),
    doubleError: error(double),
    blockedError: error(blocked),
    serialToGpuError: Math.hypot(serial[0] - worst.actual[0], serial[1] - worst.actual[1]),
  }
}
