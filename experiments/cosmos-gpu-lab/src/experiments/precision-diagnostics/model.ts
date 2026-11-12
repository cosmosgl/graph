import { gravity } from '../combined-layout/reference'
import { GRAVITY } from '../combined-layout/data'
import { compareArray } from '../many-body/reference'

export type ErrorMetrics = { finite: boolean; maxAbsolute: number; rms: number; relativeL2: number | null }
export function errorMetrics (actual: readonly number[] | Float32Array | Float64Array, expected: ArrayLike<number>): ErrorMetrics {
  if (actual.length !== expected.length || !actual.length) throw new Error('Mismatched or empty diagnostic arrays')
  let maximum = 0; let squared = 0; let norm = 0; let finite = true
  for (const [i, element] of actual.entries()) {
    const delta = element - expected[i]
    if (!Number.isFinite(element) || !Number.isFinite(expected[i])) finite = false
    maximum = Math.max(maximum, Number.isFinite(delta) ? Math.abs(delta) : Infinity)
    squared += Number.isFinite(delta) ? delta * delta : Infinity; norm += expected[i] ** 2
  }
  return { finite, maxAbsolute: maximum, rms: Math.sqrt(squared / actual.length), relativeL2: norm ? Math.sqrt(squared / norm) : null }
}

export function gravityFixture (count = 257, seed = 5931): Float32Array {
  if (!Number.isInteger(count) || count < 8 || count > 4096 ||
    !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid diagnostic fixture')
  const points = new Float32Array(count * 4)
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2; const distance = 2 ** (random() * 24 - 12)
    points[i * 4] = Math.cos(angle) * distance; points[i * 4 + 1] = Math.sin(angle) * distance
  }
  points.set([0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0])
  return points
}

// Analytic linear law on exactly uploaded f32 coordinates, evaluated in JS double.
// Constants are first converted to the same f32 values as the GPU parameters/literal.
export function linearGravity (points: Float32Array, alpha = 1): Float64Array {
  const result = new Float64Array(points.length / 2)
  const strength = Math.fround(alpha) * Math.fround(GRAVITY) * Math.fround(0.1)
  for (let i = 0; i < points.length / 4; i++) {
    result[i * 2] = -points[i * 4] * strength; result[i * 2 + 1] = -points[i * 4 + 1] * strength
  }
  return result
}
export function xy (records: Float32Array): Float32Array {
  const result = new Float32Array(records.length / 2)
  for (let i = 0; i < records.length / 4; i++) result.set(records.subarray(i * 4, i * 4 + 2), i * 2)
  return result
}
export function gravityResult (name: string, actual: Float32Array, points: Float32Array): {
  name: string; mathematicalError: ErrorMetrics; legacyCompatibility: ReturnType<typeof compareArray>;
  axisError: ErrorMetrics; nonAxisError: ErrorMetrics;
  worstComponents: Array<{ point: number; axis: 'x' | 'y'; position: number[]; actual: number; expected: number; absoluteError: number }>;
} {
  const expected = linearGravity(points); const components = xy(actual)
  const axes: number[] = []; const axisExpected: number[] = []; const regular: number[] = []; const regularExpected: number[] = []
  const examples = []
  for (let i = 0; i < points.length / 4; i++) {
    const axis = points[i * 4] === 0 || points[i * 4 + 1] === 0
    for (const side of [0, 1] as const) {
      const offset = i * 2 + side
      const actualGroup = axis ? axes : regular; const expectedGroup = axis ? axisExpected : regularExpected
      actualGroup.push(components[offset]); expectedGroup.push(expected[offset])
      examples.push({
        point: i,
        axis: side ? 'y' as const : 'x' as const,
        position: [points[i * 4], points[i * 4 + 1]],
        actual: components[offset],
        expected: expected[offset],
        absoluteError: Math.abs(components[offset] - expected[offset]),
      })
    }
  }
  return {
    name,
    mathematicalError: errorMetrics(components, expected),
    axisError: errorMetrics(axes, axisExpected),
    nonAxisError: errorMetrics(regular, regularExpected),
    worstComponents: examples.sort((a, b) => b.absoluteError - a.absoluteError).slice(0, 4),
    legacyCompatibility: compareArray(actual, gravity(points, 1).forces),
  }
}

export type SumFixture = 'cancellation' | 'positive' | 'balanced'
export function sumFixture (kind: SumFixture, count = 1024): Float32Array {
  if (!Number.isInteger(count) || count < 4 || count > 4096) throw new Error('Invalid sum count')
  const pattern = kind === 'cancellation'
    ? [16777216, 1, -16777216, 1]
    : kind === 'balanced' ? [1024, -1024, 1, -1] : [1, 2, 3, 4]
  return Float32Array.from({ length: count }, (_, i) => pattern[i % 4])
}
export function cpuSums (values: Float32Array): { exact: number; serial: number; blocked: number; tree: number } {
  // Fixtures contain bounded integers. Every partial double sum is an integer below 2^53.
  // This exactness argument does not apply to arbitrary user-supplied arrays.
  let exact = 0; let serial = 0; let blocked = 0
  for (const value of values) { exact += value; serial = Math.fround(serial + value) }
  for (let start = 0; start < values.length; start += 64) {
    let part = 0
    for (let i = start; i < Math.min(start + 64, values.length); i++) part = Math.fround(part + values[i])
    blocked = Math.fround(blocked + part)
  }
  const lanes = new Float32Array(256)
  for (let lane = 0; lane < 256; lane++) {
    for (let i = lane; i < values.length; i += 256) lanes[lane] = Math.fround(lanes[lane] + values[i])
  }
  for (let stride = 128; stride; stride >>>= 1) for (let lane = 0; lane < stride; lane++) lanes[lane] = Math.fround(lanes[lane] + lanes[lane + stride])
  return { exact, serial, blocked, tree: lanes[0] }
}
