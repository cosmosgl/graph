import type { Snapshot } from '../many-body/reference'
import { integrate } from '../many-body-grid/reference'
import { maxRadius, radius, validateCollision, validateSizes, type CollisionParameters } from './data'
const f = Math.fround
// Independent scalar translation of the production all-pairs law. Each
// arithmetic operation rounds to f32; the existing numerical budget is reused.
export function collisionReference (points: Float32Array, sizes: Float32Array, p: CollisionParameters, alpha: number): Snapshot {
  const count = points.length / 4; validateSizes(sizes, count); validateCollision(p)
  const forces = new Float32Array(points.length); const largest = maxRadius(sizes, p)
  const cooling = p.cooling > 0 ? f(Math.pow(Math.max(f(alpha), 0), f(p.cooling))) : 1
  for (let a = 0; a < count; a++) {
    const offset = a * 4; if (points[offset + 3] > 0.5) continue
    const ownRadius = radius(sizes[a], p); const ownSquare = f(ownRadius * ownRadius)
    const reject = f(ownRadius + largest); const rejectSquare = f(reject * reject)
    let x = 0; let y = 0
    for (let b = 0; b < count; b++) {
      if (a === b) continue
      const other = b * 4; const dx = f(points[offset] - points[other]); const dy = f(points[offset + 1] - points[other + 1])
      const square = f(f(dx * dx) + f(dy * dy))
      if (!(square < rejectSquare) || points[other + 3] > 0.5) continue
      const r = radius(sizes[b], p); const contact = f(ownRadius + r)
      if (square >= f(contact * contact)) continue
      let distance = f(Math.sqrt(square)); let ux: number; let uy: number
      if (distance > f(1e-4)) { ux = f(dx / distance); uy = f(dy / distance) } else {
        const angle = f(f(a) * f(2.399963229728653)); ux = f(Math.cos(angle)); uy = f(Math.sin(angle)); distance = 0
      }
      const otherSquare = f(r * r); const weight = f(f(f(contact - distance) * otherSquare) / f(ownSquare + otherSquare))
      x = f(x + f(ux * weight)); y = f(y + f(uy * weight))
    }
    const strength = f(f(p.strength) * cooling); x = f(x * strength); y = f(y * strength)
    const speed = f(Math.sqrt(f(f(x * x) + f(y * y))))
    if (speed > ownRadius) { const scale = f(ownRadius / speed); x = f(x * scale); y = f(y * scale) }
    forces.set([x, y, 0, 0], offset)
  }
  return { forces, positions: integrate(points, forces, { alpha, repulsion: 0, friction: 1, referenceLength: 4096 }) }
}
