import { expect, it } from 'vitest'
import { buildTopology, validIndex } from '../weighted-links/data'
import { createInteractiveFixture } from './interactive-fixtures'

it.each([
  { count: 65536, degree: 8120 },
  { count: 262144, degree: 8192 },
  { count: 1000000, degree: 8192 },
])('keeps the matched layouts and a moving hub at $count points', ({ count, degree }) => {
  const dense = createInteractiveFixture(count, 'dense')
  const hubs = createInteractiveFixture(count, 'hubs')
  const { points, samples } = hubs.input
  const { graph, metadata } = hubs
  expect(graph.points).toBe(points)
  expect([...points.subarray(0, 8)]).toEqual([0, 0, 1, 0, 0, 0, 0, 1])
  expect(points.every((value, index) => Number.isFinite(value) && value === dense.input.points[index])).toBe(true)
  expect(samples.every((value, index) => Number.isFinite(value) && value === dense.input.samples[index])).toBe(true)
  expect([
    graph.links.length / 2, graph.weights.length, graph.sizes.length,
  ]).toEqual([count - 10, count - 10, count])
  expect(graph.links.every(id => validIndex(id, count) && id > 1)).toBe(true)
  let pinned = 0
  let absent = 0
  let clearOrigin = true
  for (let offset = 0; offset < points.length; offset += 4) {
    if (points[offset + 2] === 1) pinned++
    if (points[offset + 3] === 1) absent++
    if (offset >= 8 && points[offset] ** 2 + points[offset + 1] ** 2 < 2500 ** 2) clearOrigin = false
  }
  expect(clearOrigin).toBe(true)
  expect([metadata.pinnedCount, metadata.absentCount]).toEqual([pinned, absent])
  expect([dense.metadata.pinnedCount, dense.metadata.absentCount]).toEqual([pinned, absent])
  expect(metadata).toMatchObject({
    pointCount: count, linkCount: count - 10, largestIncomingDegree: degree, hubId: 2, hubPinned: false,
  })
  expect(dense.metadata.largestIncomingDegree).toBeLessThan(67)
  let hubLinks = 0
  let validTopology = true
  for (let offset = 0; offset < graph.links.length; offset += 2) {
    const source = graph.links[offset]
    const target = graph.links[offset + 1]
    if (target !== dense.graph.links[offset + 1] || source === target) validTopology = false
    if (source === metadata.hubId) hubLinks++
  }
  expect(validTopology).toBe(true)
  expect(hubLinks).toBe(degree)
})

it('reports the hub degree used by the source-grouped spring pass', () => {
  const { graph, metadata } = createInteractiveFixture(1026, 'hubs')
  const sourceGrouped = buildTopology(graph).directions[0]
  expect(sourceGrouped.maxDegree).toBe(metadata.largestIncomingDegree)
  expect(sourceGrouped.offsets[metadata.hubId + 1] - sourceGrouped.offsets[metadata.hubId]).toBe(metadata.largestIncomingDegree)
})
