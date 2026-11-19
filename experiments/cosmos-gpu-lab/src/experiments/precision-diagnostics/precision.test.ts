import { expect, it } from 'vitest'
import { deviceForTest } from '../../gpu/test-device'
import { gravity } from '../combined-layout/reference'
import { cpuSums, errorMetrics, gravityFixture, gravityResult, linearGravity, sumFixture } from './model'
import { nativeDiagnostics, productionGravity } from './gpu'

it('uses analytic axis forces and separates compatibility from mathematical error', () => {
  const points = gravityFixture(257, 5931); const expected = linearGravity(points)
  expect(points).toEqual(gravityFixture(257, 5931))
  expect(points).not.toEqual(gravityFixture(257, 5932))
  expect(Math.abs(expected[0])).toBe(0); expect(expected[2]).toBe(-0.25 * Math.fround(0.1))
  expect(expected[4]).toBe(0.25 * Math.fround(0.1))
  const model = gravityResult('CPU model', gravity(points, 1).forces, points)
  expect(model.legacyCompatibility.valid).toBe(true)
  expect(model.mathematicalError.finite).toBe(true)
  expect(model.mathematicalError.maxAbsolute).toBeGreaterThan(0)
  expect(model.axisError.finite).toBe(true); expect(model.nonAxisError.finite).toBe(true)
  expect(model.worstComponents).toHaveLength(4)
  expect(errorMetrics([Infinity], [1]).finite).toBe(false)
  expect(errorMetrics([0], [0]).relativeL2).toBeNull()
  expect(() => errorMetrics([0], [0, 1])).toThrow()
})

it('has exact integer controls, adversarial cancellation and non-power-of-two tails', () => {
  for (const count of [257, 1024, 4096]) {
    const repeats = Math.floor(count / 4); const tail = count % 4
    const sum = cpuSums(sumFixture('cancellation', count))
    expect(sum.exact).toBe(repeats * 2 + (tail ? 16777216 : 0))
    expect(sum.serial).not.toBe(sum.exact)
    expect(cpuSums(sumFixture('balanced', count)).exact).toBe(tail ? 1024 : 0)
    const positive = cpuSums(sumFixture('positive', count))
    expect(positive.exact).toBe(repeats * 10 + (tail ? 1 : 0))
    expect(positive.serial).toBe(positive.exact); expect(positive.tree).toBe(positive.exact)
  }
})

it('reads production GLSL gravity and both native WGSL forces without hiding partial outputs', async context => {
  const probe = await deviceForTest(); probe?.destroy()
  if (!probe) { context.skip(); return }
  const points = gravityFixture(257); const sums = sumFixture('positive', 257)
  const gl = await productionGravity(points); const gpu = await nativeDiagnostics(points, sums)
  expect(gl.forces).toHaveLength(points.length)
  expect(gravityResult('GLSL', gl.forces, points).mathematicalError.finite).toBe(true)
  expect(gpu.gravity).toHaveLength(2)
  for (const row of gpu.gravity) {
    expect(row.forces).toHaveLength(points.length)
    expect(gravityResult(row.name, row.forces, points).mathematicalError.finite).toBe(true)
    expect(Math.abs(row.forces[0])).toBe(0)
    // Direct-law sign is independent of native atan2's special axis cases.
    if (row.name === 'WGSL Cartesian') expect(row.forces[4]).toBeCloseTo(-0.025, 5)
  }
  for (const row of gpu.sums) expect(row.value).toBe(641)
  const cancellation = await nativeDiagnostics(points, sumFixture('cancellation', 1024))
  expect(cancellation.sums).toHaveLength(3)
  // Native evaluation may be more accurate than the stepwise CPU model.
  // Keep its cancellation error diagnostic; do not require an inaccurate answer.
  expect(cancellation.sums.every(row => Number.isFinite(row.value))).toBe(true)
  const additionOnly = await nativeDiagnostics(new Float32Array(), sums, 'addition')
  expect(additionOnly.gravity).toHaveLength(0)
  expect(additionOnly.sums.map(row => row.value)).toEqual(gpu.sums.map(row => row.value))
  const gravityOnly = await nativeDiagnostics(points, new Float32Array(), 'gravity')
  expect(gravityOnly.gravity.map(row => row.name)).toEqual(gpu.gravity.map(row => row.name))
  expect(gravityOnly.sums).toHaveLength(0)
})
