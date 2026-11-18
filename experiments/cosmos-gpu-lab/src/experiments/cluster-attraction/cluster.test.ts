import { expect, it } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { fixture, grouping, SETTINGS } from './data'
import { reference, compare } from './reference'
import { createBackend, replaceCanvas } from './backend'
import { changedMembership } from './study'
it('separates membership, centroid mass, pinned/absent masks and point strength', () => {
  const input = fixture('semantics'); const result = reference(input)
  expect(Array.from(result.aggregates)).toEqual([0, 0, 2, 0, 12, 4, 1, 0, -16, -16, 2, 0, 0, 0, 0, 0])
  expect(result.positions[0]).toBe(-8) // Pinned but contributes.
  expect(result.forces[4]).toBeCloseTo(-8 * SETTINGS.alpha * SETTINGS.strength * 2, 6)
  expect(result.forces[8]).toBe(0) // Singleton already at its centroid.
  expect(result.positions[12]).toBe(40) // No membership.
  expect(Number.isNaN(result.positions[16])).toBe(true)
  expect(result.positions[20]).toBe(9000) // Absent finite sentinel remains unchanged.
  expect(result.forces[24]).toBe(0) // Zero strength at negative custom target.
  expect(result.forces[28]).toBeLessThan(0)
})
it('groups stable original IDs, chunks a large group, and retains empty groups', () => {
  const index = grouping(fixture('semantics'))
  expect(Array.from(index.members)).toEqual([0, 1, 4, 5, 2, 6, 7])
  expect(Array.from(index.ranges)).toEqual([0, 1, 0, 0, 1, 1, 0, 0, 2, 1, 0, 0, 3, 0, 0, 0])
  const large = grouping(fixture('uneven', 8192))
  expect(large.ranges[1]).toBe(32); expect(large.members.length).toBe(8192)
  expect(new Set(large.members).size).toBe(8192)
})
for (const api of ['webgl', 'webgpu'] as const) {
  for (const mode of ['semantics', 'all-unassigned', 'all-absent'] as const) {
    it(`${api}: production semantics / ${mode}, updates and repeated reductions`, async () => {
      const input = fixture('semantics')
      if (mode === 'all-unassigned') input.membership.fill(-1)
      if (mode === 'all-absent') for (let i = 3; i < input.points.length; i += 4) input.points[i] = 1
      const backend = await createBackend(api, document.createElement('canvas'), input)
      try {
        backend.step(); const actual = await backend.read()
        const checks = compare(actual, reference(input), input.points)
        if (!checks.valid) await writeArtifact(`cluster-${api}-${mode}`, { checks, actual, expected: reference(input), environment: backend.environment() })
        expect(checks.valid, JSON.stringify(checks)).toBe(true)
        const changed = changedMembership(input); backend.updateClusters(changed); backend.setPositions(changed.points); backend.step()
        expect(compare(await backend.read(), reference(changed), changed.points)).toMatchObject({ valid: true })
        backend.updateClusters(input); backend.setPositions(input.points)
        await backend.measureForce(3)
        const after = await backend.read()
        for (let i = 2; i < after.aggregates.length; i += 4) expect(after.aggregates[i]).toBe(reference(input).aggregates[i])
      } finally { backend.destroy(); backend.destroy() }
    })
  }
  it(`${api}: replace the complete data and recreate different capacities`, async () => {
    let canvas = document.createElement('canvas')
    for (const count of [33, 257, 1]) {
      canvas = replaceCanvas(canvas)
      const input = fixture('single-group', count); const b = await createBackend(api, canvas, input)
      try {
        b.step(); const actual = await b.read(); const checks = compare(actual, reference(input), input.points)
        if (!checks.valid) await writeArtifact(`cluster-${api}-replacement-${count}`, { checks, actual, expected: reference(input) })
        expect(checks.valid, JSON.stringify(checks)).toBe(true)
      } finally { b.destroy() }
    }
  })
}
