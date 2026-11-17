import { stress, stressPairs, springMismatch } from '../matched-layout/metrics'
import { displacement, shape } from '../repulsion-trajectories/metrics'
import { forceSettings } from '../combined-layout/production-settings'
import type { Integrated } from './runtime'
export function measureQuality (r: Integrated, points: Float32Array, before: Float32Array): {
  stressRms: number | null; springMismatch: number | null; motionRms: number; radius: number; overlapPairs: number; pairs: number;
} {
  const pairs = stressPairs(r.data.graph).pairs
  // Exact screen-space circle overlap count. Outside all timing windows.
  let overlapPairs = 0; const zoom = r.renderer.camera.zoom
  for (let i = 0; i < points.length / 4; i++) {
    if (points[i * 4 + 3] > 0.5 || r.renderer.styles[i * 8 + 3] <= 0) continue
    for (let j = 0; j < i; j++) {
      if (points[j * 4 + 3] > 0.5 || r.renderer.styles[j * 8 + 3] <= 0) continue
      const radius = (r.renderer.styles[i * 8 + 4] + r.renderer.styles[j * 8 + 4]) / 2
      const dx = (points[i * 4] - points[j * 4]) * zoom; const dy = (points[i * 4 + 1] - points[j * 4 + 1]) * zoom
      if (dx * dx + dy * dy < radius * radius) overlapPairs++
    }
  }
  return {
    stressRms: stress(points, pairs).rms,
    springMismatch: springMismatch(points, r.data.graph, forceSettings('reference', points.length / 4)),
    motionRms: displacement(points, before).rms,
    radius: shape(points).radius,
    overlapPairs,
    pairs: pairs.length,
  }
}
