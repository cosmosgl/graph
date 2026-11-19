import { cellOf, layout } from '../many-body-grid/data'
import { createFixture, type Input } from '../many-body/data'
import type { GraphInput } from '../weighted-links/data'
import { percentile } from './field-metrics'

const communityCount = 8
const anchorDegree = 64
const circleRadius = 3200
const anchorRadius = 210
const jitter = 24
const centers = Array.from({ length: communityCount }, (_, i): [number, number] => [
  circleRadius * Math.cos(i * 2 * Math.PI / communityCount),
  circleRadius * Math.sin(i * 2 * Math.PI / communityCount),
])
const neighborhoodRadius = circleRadius * 2 * Math.sin(Math.PI / communityCount) * 0.4

export type DenseCommunities = { input: Input; graph: GraphInput; firstAnchor: number; anchorCount: number }
export const denseFixtureParameters = { communityCount, anchorDegree, circleRadius, anchorRadius, jitter, neighborhoodRadius }

// Local springs to distributed anchors retain the starting communities. Fixed
// anchors are separate from free IDs so motion samples span every community.
export function createDenseCommunities (count: number): DenseCommunities {
  if (!Number.isInteger(count) || count < 1026 || count > 1000000) throw new Error('Expected 1,026–1,000,000 points')
  const input = createFixture('uniform', count)
  const anchorCount = Math.ceil((count - 2) / (anchorDegree + 1))
  const firstAnchor = count - anchorCount
  const leafEdges = firstAnchor - 2
  const edgeCount = leafEdges + anchorCount - communityCount
  const links = new Float32Array(edgeCount * 2)
  input.points.set([centers[0][0], centers[0][1], 1, 0, centers[0][0], centers[0][1], 0, 1])
  for (let j = 0; j < anchorCount; j++) {
    const i = (firstAnchor + j) * 4
    const [cx, cy] = centers[j % communityCount]
    const radius = Math.sqrt((input.points[i] + 64) / 128) * anchorRadius
    const angle = (input.points[i + 1] + 64) / 128 * 2 * Math.PI
    input.points[i] = cx + radius * Math.cos(angle)
    input.points[i + 1] = cy + radius * Math.sin(angle)
    input.points[i + 2] = 1
  }
  for (let edge = 0; edge < leafEdges; edge++) {
    const point = edge + 2
    const anchor = firstAnchor + edge % anchorCount
    input.points[point * 4] = input.points[anchor * 4] + input.points[point * 4] / 64 * jitter
    input.points[point * 4 + 1] = input.points[anchor * 4 + 1] + input.points[point * 4 + 1] / 64 * jitter
    links[edge * 2] = anchor; links[edge * 2 + 1] = point
  }
  for (let j = communityCount; j < anchorCount; j++) {
    const edge = leafEdges + j - communityCount
    links[edge * 2] = firstAnchor + j - communityCount
    links[edge * 2 + 1] = firstAnchor + j
  }
  return {
    input,
    graph: { points: input.points, links, weights: new Float32Array(edgeCount).fill(1), sizes: new Float32Array(count).fill(2) },
    firstAnchor,
    anchorCount,
  }
}

export function communityDensity (fixture: DenseCommunities, positions: Float32Array, box: Float32Array): {
  occupancyP95: number; maximumOccupancy: number; occupiedCells: number; retainedFreeFraction: number;
} {
  const finest = layout(positions.length / 4).finest
  const counts = new Uint32Array(finest * finest)
  let retained = 0
  for (let i = 0; i < positions.length / 4; i++) {
    if (positions[i * 4 + 3]) continue
    const x = positions[i * 4]; const y = positions[i * 4 + 1]
    counts[cellOf(x, y, finest, box)]++
    if (i < 2 || i >= fixture.firstAnchor) continue
    const [cx, cy] = centers[((i - 2) % fixture.anchorCount) % communityCount]
    if ((x - cx) ** 2 + (y - cy) ** 2 <= neighborhoodRadius ** 2) retained++
  }
  const occupied = [...counts].filter(n => n > 0)
  return {
    occupancyP95: percentile(occupied, 0.95),
    maximumOccupancy: occupied.reduce((max, n) => Math.max(max, n), 0),
    occupiedCells: occupied.length,
    retainedFreeFraction: retained / (fixture.firstAnchor - 2),
  }
}
