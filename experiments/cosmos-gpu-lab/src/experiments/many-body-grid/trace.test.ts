import { expect, it } from 'vitest'
import { deviceForTest } from '../../gpu/test-device'
import { createFixture, PARAMETERS } from '../many-body/data'
import { comparePresent, gridReference } from './reference'
import { frameFor } from './data'
import { createTrace, traceChecks, replaceOnce } from './trace'
import { createGridWebGL } from './webgl'
import { createGridWebGPU } from './webgpu'

it('rejects stale diagnostic shader anchors', () => {
  expect(() => replaceOnce('abc', 'missing', '')).toThrow('anchor changed')
  expect(() => replaceOnce('aa', 'a', '')).toThrow('anchor changed')
})
for (const create of [createGridWebGL, createGridWebGPU]) {
  for (const fixture of ['uniform', 'clusters', 'edge-cases'] as const) {
    it(`${create.name} ${fixture}: diagnostic replay preserves normal output and captures force stages`, async context => {
      if (create === createGridWebGPU) {
        const probe = await deviceForTest(); probe?.destroy(); if (!probe) { context.skip(); return }
      }
      const count = fixture === 'clusters' ? 8192 : 65
      const input = createFixture(fixture, count); const frame = frameFor(input.points, 0, 8)
      const backend = await create(document.createElement('canvas'), input, PARAMETERS, frame)
      try {
        backend.step(); const normal = await backend.read(); const structure = await backend.readStructure()
        const expectedTrace = createTrace(input.points.length / 4)
        const expected = gridReference(input, input.points, PARAMETERS, frame, structure, expectedTrace)
        const actual = await backend.diagnose!()
        const replay = comparePresent({ ...normal, forces: actual.forces }, normal, input.points)
        expect(replay, JSON.stringify(replay)).toMatchObject({ valid: true })
        expect(comparePresent(await backend.read(), normal, input.points)).toMatchObject({ valid: true })
        const checks = traceChecks({ ...actual.trace, final: normal.forces, positions: normal.positions },
          { ...expectedTrace, final: expected.forces, positions: expected.positions }, input.points)
        expect(checks).toHaveLength(Object.keys(expectedTrace).length + 2)
        expect(checks.every(c => Number.isFinite(c.check.maxError))).toBe(true)
        if (fixture !== 'clusters') expect(checks.every(c => c.check.valid), JSON.stringify(checks)).toBe(true)
        const far = actual.trace[Object.keys(expectedTrace).filter(k => k.startsWith('far ')).at(-1)!]
        const sum = Float32Array.from(far, (v, i) => v + actual.trace['near clamped'][i])
        expect(comparePresent({ ...normal, forces: sum }, normal, input.points)).toMatchObject({ valid: true })
      } finally { backend.destroy() }
    })
  }
}

it('reports the worst error relative to the fixed budget and rejects missing or non-finite stages', () => {
  const points = new Float32Array(8)
  const expected = { stage: new Float32Array([1000, 0, 0, 0, 0, 0, 0, 0]) }
  const actual = { stage: new Float32Array([1000.01, 0.001, 0, 0, 0, 0, 0, 0]) }
  const [check] = traceChecks(actual, expected, points)
  expect(check.check.valid).toBe(false)
  expect(check.worst).toMatchObject({ point: 0, axis: 'y' })
  expect(traceChecks({}, expected, points)[0].check.valid).toBe(false)
  actual.stage[0] = NaN
  expect(traceChecks(actual, expected, points)[0].worst?.ratio).toBe(Infinity)
})
