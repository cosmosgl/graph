import type { ScaleFixture } from './scale-fixture'

export const scaleCheckpoints = [0, 1, 4, 8, 16, 31, 32, 99, 100] as const

/** Exact pair count for the fixture's padded collision circles. Each earlier point occupies one bucket. */
function overlaps (xy: Float32Array, radii: Float32Array): { pairs: number; maxDepth: number; rmsDepth: number } {
  const width = 2 * Math.max(...radii)
  const grid = new Map<string, number[]>()
  let pairs = 0
  let squaredDepth = 0
  let maxDepth = 0
  for (let i = 0; i < radii.length; i++) {
    if (i === 1) continue // the only absent slot
    const x = xy[2 * i]
    const y = xy[2 * i + 1]
    const col = Math.floor(x / width)
    const row = Math.floor(y / width)
    for (let ix = col - 1; ix <= col + 1; ix++) {
      for (let iy = row - 1; iy <= row + 1; iy++) {
        const others = grid.get(`${ix},${iy}`)
        if (!others) continue
        for (const j of others) {
          const dx = x - xy[2 * j]
          const dy = y - xy[2 * j + 1]
          const contact = radii[i] + radii[j]
          const squared = dx * dx + dy * dy
          if (squared >= contact * contact) continue
          const depth = contact - Math.sqrt(squared)
          pairs++
          squaredDepth += depth * depth
          maxDepth = Math.max(maxDepth, depth)
        }
      }
    }
    const key = `${col},${row}`
    const bucket = grid.get(key)
    if (bucket) bucket.push(i)
    else grid.set(key, [i])
  }
  return { pairs, maxDepth, rmsDepth: pairs ? Math.sqrt(squaredDepth / pairs) : 0 }
}

/** All distances are calculated from a fresh public XY read in graph units. */
export function scaleMetrics (fixture: ScaleFixture, xy: Float32Array): {
  communities: { members: number; retainedFraction: number; rmsSpread: number }[];
  springRmsError: number;
  overlap: ReturnType<typeof overlaps>;
  hub: { id: number; displacement: number; incidentEdges: number; meanLength: number; p95Length: number; maxLength: number };
} {
  const { metadata, positions, links, sizes, firstAnchor, communityCenters, communities, neighborhoodRadius } = fixture
  const radii = Float32Array.from(sizes, d => d / 2 + fixture.padding)
  const stats = communityCenters.map(() => ({ members: 0, retained: 0, x: 0, y: 0, squares: 0 }))
  // Only free leaves have an assigned membership in the community retention denominator.
  for (let id = 2; id < firstAnchor; id++) {
    const group = communities[id]
    const [cx, cy] = communityCenters[group]
    const dx = xy[id * 2] - cx
    const dy = xy[id * 2 + 1] - cy
    const stat = stats[group]
    stat.members++
    stat.x += dx
    stat.y += dy
    const r2 = dx * dx + dy * dy
    stat.squares += r2
    if (r2 <= neighborhoodRadius * neighborhoodRadius) stat.retained++
  }
  const { hubId } = metadata
  const lengths = []
  let sumSquaredSpringError = 0
  for (let edge = 0; edge < links.length; edge += 2) {
    const a = links[edge]
    const b = links[edge + 1]
    const length = Math.hypot(xy[a * 2] - xy[b * 2], xy[a * 2 + 1] - xy[b * 2 + 1])
    if (a === hubId || b === hubId) lengths.push(length)
    // Both variation endpoints are 1. With collision on, springs respect endpoint contact.
    const rest = Math.max(fixture.restLength, radii[a] + radii[b])
    sumSquaredSpringError += (length - rest) ** 2
  }
  lengths.sort((a, b) => a - b)
  return {
    communities: stats.map(stat => {
      const { members, retained } = stat
      const meanSquared = (stat.x / members) ** 2 + (stat.y / members) ** 2
      return { members, retainedFraction: retained / members, rmsSpread: Math.sqrt(Math.max(0, stat.squares / members - meanSquared)) }
    }),
    springRmsError: Math.sqrt(sumSquaredSpringError / (links.length / 2)),
    overlap: overlaps(xy, radii),
    hub: {
      id: hubId,
      displacement: Math.hypot(xy[hubId * 2] - positions[hubId * 2], xy[hubId * 2 + 1] - positions[hubId * 2 + 1]),
      incidentEdges: lengths.length,
      meanLength: lengths.reduce((total, value) => total + value, 0) / lengths.length,
      p95Length: lengths[Math.ceil(lengths.length * 0.95) - 1],
      maxLength: lengths[lengths.length - 1],
    },
  }
}
