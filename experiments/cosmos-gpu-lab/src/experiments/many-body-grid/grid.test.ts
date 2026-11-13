import { describe, expect, it } from 'vitest'
import { deviceForTest } from '../../gpu/test-device'
import { createFixture, PARAMETERS } from '../many-body/data'
import { compareArray } from '../many-body/reference'
import { buildReference, cellOf, frameFor, layout } from './data'
import { comparePresent, gridReference, approximationError, integrate } from './reference'
import { compareStructure } from './validation'
import { createGridWebGL } from './webgl'
import { createGridWebGPU } from './webgpu'

it('preserves the grid parent relation at boundaries and conserves all present mass', () => {
  const input = createFixture('edge-cases'); const frame = frameFor(input.points, 0)
  const structure = buildReference(input.points, frame); const l = layout(8)
  for (const [level, n] of l.sizes.entries()) {
    let count = 0
    for (let c = 0; c < n * n; c++) count += structure.aggregates[(l.offsets[level] + c) * 4 + 2]
    expect(count).toBe(6)
    for (let i = 0; i < 100; i++) {
      const x = Math.fround(frame.bounds[0] + i / 100 * frame.bounds[2]); const y = 0
      const fine = cellOf(x, y, n * 2, frame.bounds); const coarse = cellOf(x, y, n, frame.bounds)
      expect(Math.floor((fine % (n * 2)) / 2)).toBe(coarse % n)
      expect(Math.floor(Math.floor(fine / (n * 2)) / 2)).toBe(Math.floor(coarse / n))
    }
  }
})
for (const create of [createGridWebGL, createGridWebGPU]) {
  describe(create.name, () => {
    for (const fixture of ['uniform'] as const) {
      it(`${fixture}: above production cutoff with independently constructed grids`, async context => {
        if (create === createGridWebGPU) {
          const probe = await deviceForTest(); probe?.destroy(); if (!probe) { context.skip(); return }
        }
        const input = createFixture(fixture, 8192); const frame = frameFor(input.points, 0, 8)
        const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
        const expectedStructure = buildReference(input.points, frame)
        const expected = gridReference(input, input.points, PARAMETERS, frame, expectedStructure)
        const backend = await create(canvas, input, PARAMETERS, frame)
        try {
          backend.step(); const actual = await backend.read(); const structure = await backend.readStructure()
          const structural = compareStructure(structure, expectedStructure)
          expect(structural, JSON.stringify(structural)).toMatchObject({ valid: true })
          const check = comparePresent(actual, expected, input.points)
          const local = comparePresent(actual, gridReference(input, input.points, PARAMETERS, frame, structure), input.points)
          expect(check, JSON.stringify({ check, local })).toMatchObject({ valid: true })
        } finally { backend.destroy() }
      })
    }
    for (const fixture of ['uniform', 'clusters', 'coincident', 'edge-cases', 'boundary'] as const) {
      it(`${fixture}: independently built hierarchy, selected identities, force and integration`, async context => {
        if (create === createGridWebGPU) {
          const probe = await deviceForTest(); probe?.destroy(); if (!probe) { context.skip(); return }
        }
        const input = createFixture(fixture, 65); let positions = input.points
        const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 340
        const backend = await create(canvas, input, PARAMETERS, frameFor(positions, 0, 8))
        try {
          for (let tick = 0; tick < 3; tick++) {
            const frame = frameFor(positions, tick, 8, tick !== 1)
            const expectedStructure = buildReference(positions, frame)
            const expected = gridReference(input, positions, PARAMETERS, frame, expectedStructure)
            backend.setPositions(positions); backend.setFrame(frame); backend.step()
            const actual = await backend.read(); const structure = await backend.readStructure()
            const structural = compareStructure(structure, expectedStructure)
            expect(structural, JSON.stringify(structural)).toMatchObject({ valid: true })
            const check = comparePresent(actual, expected, positions)
            expect(check, JSON.stringify(check)).toMatchObject({ valid: true })
            const local = comparePresent(actual, gridReference(input, positions, PARAMETERS, frame, structure), positions)
            expect(local).toMatchObject({ valid: true })
            positions = expected.positions
          }
          backend.render([0, 0, 0.001, 0.001])
        } finally { backend.destroy() }
      })
    }
  })
}
it('separates approximation error from port validation and handles zero exact force', () => {
  const input = createFixture('pair'); const frame = frameFor(input.points, 0, 8)
  const result = gridReference(input, input.points, PARAMETERS, frame, buildReference(input.points, frame))
  expect(approximationError(input, input.points, result.forces, PARAMETERS, frame).targets).toBe(2)
  const single = createFixture('uniform', 1); const singleFrame = frameFor(single.points, 0)
  expect(approximationError(single, single.points, new Float32Array(4), PARAMETERS, singleFrame)).toMatchObject({
    versusProductionExactPercent: 0, versusExactGridPartitionPercent: 0,
  })
})

// Dense CPU/GPU arithmetic discrepancies remain visible in the demo. These tests
// gate the production-port and integration contracts independently, without
// loosening the full CPU comparison or pretending it passes on this fixture.
it('dense 8192-point port matches production and isolates integration from force rounding', async context => {
  const probe = await deviceForTest(); probe?.destroy(); if (!probe) { context.skip(); return }
  const input = createFixture('clusters', 8192); const frame = frameFor(input.points, 0, 8)
  const expectedStructure = buildReference(input.points, frame)
  const backends = []
  try {
    for (const create of [createGridWebGL, createGridWebGPU]) {
      backends.push(await create(document.createElement('canvas'), input, PARAMETERS, frame))
    }
    const snapshots = []
    for (const backend of backends) {
      backend.step(); const actual = await backend.read()
      expect(compareStructure(await backend.readStructure(), expectedStructure)).toMatchObject({ valid: true })
      const integration = compareArray(actual.positions, integrate(input.points, actual.forces, PARAMETERS), input.points)
      expect(integration, JSON.stringify(integration)).toMatchObject({ valid: true })
      snapshots.push(actual)
    }
    const cross = comparePresent(snapshots[1], snapshots[0], input.points)
    expect(cross, JSON.stringify(cross)).toMatchObject({ valid: true })
  } finally { backends.forEach(b => b.destroy()) }
})
