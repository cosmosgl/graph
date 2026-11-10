import { expect, it } from 'vitest'
import { deviceForTest } from '../../gpu/test-device'
import { createFixture, PARAMETERS } from '../many-body/data'
import { createGridWebGPU } from './webgpu'
import { compareCentroidPass } from './centroid-comparison'
import { centroidReference, centroidRounding } from './centroids'
import { frameFor } from './data'

it('rounds CPU centroids once, handles empty cells and distinguishes one ULP from a tolerance pass', () => {
  const expected = centroidReference({ aggregates: new Float32Array([1, -1, 3, 0, 0, 0, 0, 0]), slots: new Float32Array() })
  expect(expected).toEqual(new Float32Array([1 / 3, -1 / 3, 3, 0, 0, 0, 0, 0]))
  const actual = expected.slice(); const bits = new Uint32Array(actual.buffer); bits[0]++; bits[1]++
  expect(centroidRounding(actual, expected)).toMatchObject({ differingComponents: 2, maxUlp: 1 })
  expect(centroidRounding(new Float32Array([-0]), new Float32Array([0]))).toMatchObject({ differingComponents: 0 })
  expect(centroidRounding(new Float32Array(), expected).maxError).toBe(Infinity)
})
for (const fixture of ['uniform', 'clusters', 'edge-cases'] as const) {
  it(`${fixture}: stored centroids preserve structure and replay while retaining the independent CPU verdict`, async context => {
    const probe = await deviceForTest(); probe?.destroy(); if (!probe) { context.skip(); return }
    const input = createFixture(fixture, fixture === 'clusters' ? 8192 : 65)
    const frame = frameFor(input.points, 0)
    const inline = await createGridWebGPU(document.createElement('canvas'), input, PARAMETERS, frame)
    try {
      inline.step(); const snapshot = await inline.read()
      const result = await compareCentroidPass(input, input.points, PARAMETERS, frame, snapshot)
      expect(result.corrected.centroids).toMatchObject({ differingComponents: 0, maxUlp: 0, maxError: 0 })
      expect(result.corrected.division).toMatchObject({ cases: 131080, mismatches: 0, firstFailure: null })
      expect(result.corrected.replay.valid, JSON.stringify(result.corrected.replay)).toBe(true)
      if (fixture !== 'clusters') expect(result.corrected.storedPassed, JSON.stringify(result.corrected)).toBe(true)
      expect(result.structural.valid).toBe(true)
      expect(result.replay.valid, JSON.stringify(result.replay)).toBe(true)
      expect(result.extraDispatches).toBe(1)
      expect(result.extraStorageBytes).toBeGreaterThan(0)
      expect(Number.isFinite(result.centroids.maxError)).toBe(true)
      expect(result.centroidCheck.valid).toBe(true)
      if (fixture !== 'clusters') expect(result.storedPassed, JSON.stringify(result)).toBe(true)
      expect((await inline.read()).positions).toEqual(snapshot.positions)
      // Dense parity is a measured outcome, not an assumed fix. Never loosen its budget.
      expect(result.stages.every(stage => Number.isFinite(stage.check.maxError))).toBe(true)
    } finally { inline.destroy() }
  })
}
