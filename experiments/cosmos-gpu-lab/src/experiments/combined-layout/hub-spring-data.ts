import { createGraph } from './data'
export function createHubGraph (count: number, degree: number, pinned: boolean): ReturnType<typeof createGraph> {
  if (!Number.isInteger(degree) || degree < 1 || degree >= count) throw new Error('Hub degree must be 1–pointCount−1')
  const data = createGraph({ fixture: 'star', count, decay: 100, springPrecision: 'trig' })
  // A connected broom: degree spokes, then one chain through the remainder.
  // Point count, total edge count, positions, sizes and weights stay fixed.
  for (let i = 1; i < count; i++) data.graph.links[(i - 1) * 2] = i <= degree ? 0 : i - 1
  data.input.points.set([-32, 16, pinned ? 1 : 0, 0], 0)
  return data
}
export function hubDegrees (count: number): number[] { return [...new Set([64, 256, 1024, 4096, count - 1].filter(d => d < count))].sort((a, b) => a - b) }
