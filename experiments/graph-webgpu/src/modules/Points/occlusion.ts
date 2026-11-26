import type { GraphData } from '@/graph/modules/GraphData'

/** Estimated area of potentially opaque sprites, before the view's diameter scale. */
export function estimateOpaqueArea (data: GraphData): number {
  const count = data.pointsNumber ?? 0
  const samples = Math.min(count, 64)
  let area = 0
  // Sample evenly across the data when styles change. This estimate only
  // chooses a drawing algorithm; the fragment shader always checks final alpha.
  for (let i = 0; i < samples; i++) {
    const id = Math.floor((i + 0.5) * count / samples)
    if (data.getResolvedPointColorChannel(id, 3) === 1 || data.pointDrawsImage(id)) {
      area += Math.max(0, data.getResolvedPointFootprint(id)) ** 2
    }
  }
  return samples ? area * count / samples : 0
}
