import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { replaceCanvas } from '../../gpu/force-preview'
import { fixture, packAttractors, changedTargets, SETTINGS, type AttractorInput } from './data'
import { reference, compare } from './reference'
import { createBackend } from './backend'
it('keeps pins, absent positions, missing targets, coincidence and signed/default strengths distinct', () => {
  const input = fixture('semantics'); const result = reference(input)
  expect(result.positions[0]).toBe(-8)
  expect(result.forces[4]).toBeCloseTo(-0.96, 6)
  expect(result.forces[8]).toBe(0) // Already at destination.
  expect(result.positions[12]).toBe(40) // Missing X.
  expect(Number.isNaN(result.positions[16])).toBe(true)
  expect(result.positions[20]).toBe(9000) // Absent finite sentinel.
  expect(result.forces[24]).toBe(0) // Zero strength.
  expect(result.forces[28]).toBeLessThan(0)
  expect(result.forces[32]).toBeCloseTo(-0.48, 6) // Negative strength moves away.
  expect(result.forces[36]).toBe(0) // Non-finite Y.
  expect(result.forces[40]).toBeCloseTo(0.36, 6) // NaN defaults to one.
  expect(result.forces[44]).toBeCloseTo(-0.36, 6) // Infinity also defaults to one.
})
it('packs production channels without editing caller arrays or treating negative coordinates as absent', () => {
  const input = fixture('semantics'); const before = { points: input.points.slice(), targets: input.targets!.slice(), strengths: input.strengths!.slice() }
  const packed = packAttractors(input)
  expect(packed.active).toBe(true)
  expect(Array.from(packed.values.slice(28, 32))).toEqual([-12, -16, 0.5, 1])
  expect(Array.from(packed.values.slice(12, 16))).toEqual([0, 0, 0, 0])
  expect(Array.from(packed.values.slice(40, 44))).toEqual([0, 0, 1, 1])
  expect(input.points).toEqual(before.points); expect(input.targets).toEqual(before.targets); expect(input.strengths).toEqual(before.strengths)
})
it('normalizes each mismatched channel independently and skips an entirely inactive stage', () => {
  const input = fixture('semantics')
  const disabled = { ...input, targets: new Float32Array(2) }
  expect(packAttractors(disabled).active).toBe(false)
  expect(reference(disabled).positions).toEqual(input.points)
  const defaulted = { ...input, strengths: new Float32Array(1).fill(0) }
  expect(packAttractors(defaulted).values[6]).toBe(1)
  expect(reference(defaulted).forces[4]).toBeCloseTo(-0.48, 6)
})
for (const api of ['webgl', 'webgpu'] as const) {
  for (const mode of ['semantics', 'no-targets', 'nonfinite-targets', 'wrong-target-length', 'default-strengths', 'wrong-strength-length', 'zero-strengths'] as const) {
    it(`${api}: ${mode}, live updates, disable and re-enable without resetting positions`, async () => {
      const input: AttractorInput = fixture('semantics')
      if (mode === 'no-targets') input.targets = undefined
      if (mode === 'nonfinite-targets') input.targets!.fill(NaN)
      if (mode === 'wrong-target-length') input.targets = new Float32Array(2)
      if (mode === 'default-strengths') input.strengths = undefined
      if (mode === 'wrong-strength-length') input.strengths = new Float32Array(1)
      if (mode === 'zero-strengths') input.strengths!.fill(0)
      const backend = await createBackend(api, document.createElement('canvas'), input)
      try {
        backend.step(); const actual = await backend.read(); const checks = compare(actual, reference(input), input.points)
        if (!checks.valid) await writeArtifact(`attractor-${api}-${mode}`, { checks, actual, expected: reference(input), environment: backend.environment() })
        expect(checks.valid, JSON.stringify(checks)).toBe(true)
        let before = actual.positions
        const changed = changedTargets(input); backend.updateAttractors(changed); backend.step()
        const updated = await backend.read()
        expect(compare(updated, reference(changed, before), before)).toMatchObject({ valid: true })
        before = updated.positions
        backend.updateAttractors({ ...changed, targets: undefined }); backend.step()
        expect((await backend.read()).positions).toEqual(before)
        expect((await backend.read()).forces.every(v => v === 0)).toBe(true)
        expect(() => backend.measureForce(1)).toThrow('Inactive attractors')
        backend.updateAttractors(changed); backend.step()
        expect(compare(await backend.read(), reference(changed, before), before)).toMatchObject({ valid: true })
        backend.setPositions(input.points)
        await backend.measureForce(3)
        const after = await backend.read()
        expect(compare(after, { ...reference(changed), positions: input.points }, input.points)).toMatchObject({ valid: true })
        expect(() => backend.updateAttractors(fixture('shared-target', 13))).toThrow('Count changes require data replacement')
      } finally { backend.destroy(); backend.destroy() }
    })
  }
  for (const key of ['alpha', 'strength'] as const) {
    it(`${api}: zero ${key} leaves positions unchanged`, async () => {
      const input = fixture('semantics'); const settings = { ...SETTINGS, [key]: 0 }
      const b = await createBackend(api, document.createElement('canvas'), input, settings)
      try { b.step(); expect(compare(await b.read(), reference(input, input.points, settings), input.points)).toMatchObject({ valid: true }) } finally { b.destroy() }
    })
  }
  it(`${api}: complete data replacement handles changed capacities`, async () => {
    let canvas = document.createElement('canvas')
    for (const count of [33, 257, 1]) {
      canvas = replaceCanvas(canvas)
      const input = fixture('individual-targets', count); const b = await createBackend(api, canvas, input)
      try {
        b.step(); const actual = await b.read(); const checks = compare(actual, reference(input), input.points)
        if (!checks.valid) await writeArtifact(`attractor-${api}-replacement-${count}`, { checks, actual, expected: reference(input) })
        expect(checks.valid, JSON.stringify(checks)).toBe(true)
      } finally { b.destroy() }
    }
  })
}
