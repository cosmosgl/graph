import type { Snapshot } from '../many-body/reference'
import { integrate } from '../many-body-grid/reference'
import { REPULSION } from './data'
const f = Math.fround
// Independent scalar sum in JS double precision, rounded to the vec4 aggregate
// consumed by production GLSL. This does not emulate GPU reduction order.
export function centerAggregate (points: Float32Array): Float32Array {
  let x = 0; let y = 0; let count = 0
  for (let i = 0; i < points.length; i += 4) {
    if (points[i + 3] > 0.5) continue
    x += points[i]; y += points[i + 1]; count++
  }
  return new Float32Array([x, y, count, 0])
}
export function centerReference (points: Float32Array, alpha: number, strength: number): Snapshot {
  const sum = centerAggregate(points); const forces = new Float32Array(points.length)
  if (sum[2]) {
    const x = f(sum[0] / sum[2]); const y = f(sum[1] / sum[2])
    for (let i = 0; i < points.length; i += 4) {
      // Match the production force shader, including unused absent-target
      // forces. The integrator independently preserves pinned/absent positions.
      const dx = f(x - points[i]); const dy = f(y - points[i + 1])
      const distance = f(Math.sqrt(f(f(dx * dx) + f(dy * dy))))
      if (distance > 0) {
        const angle = f(Math.atan2(dy, dx)); const magnitude = f(f(f(f(alpha) * f(strength)) * distance) * f(0.01))
        forces[i] = f(magnitude * f(Math.cos(angle))); forces[i + 1] = f(magnitude * f(Math.sin(angle)))
      }
    }
  }
  return { forces, positions: integrate(points, forces, REPULSION) }
}
