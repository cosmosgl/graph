import type { View } from '../many-body/backend'
import { radius, type CollisionParameters } from './data'
// Include complete discs across all lanes/controls before freezing one camera.
export function collisionView (lanes: Float32Array[], sizes: Float32Array, settings: CollisionParameters): View {
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity
  for (const points of lanes) {
    for (const [i, size] of sizes.entries()) {
      if (points[i * 4 + 3] > 0.5) continue
      const x = points[i * 4]; const y = points[i * 4 + 1]; const r = radius(size, settings)
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r)
    }
  }
  if (!Number.isFinite(x0)) return [0, 0, 1 / 16, 1 / 16]
  const half = Math.max(16, (y1 - y0) / 2, (x1 - x0) / 2 / (480 / 340)) * 1.1
  return [(x0 + x1) / 2, (y0 + y1) / 2, 1 / (half * 480 / 340), 1 / half]
}
