import type { Input } from '../many-body/data'
import { referenceTick as exactTick, type Snapshot } from '../many-body/reference'
import { buildReference, frameFor } from '../many-body-grid/data'
import { gridReference, integrate } from '../many-body-grid/reference'
import { createReferenceIndex, referenceTick as springTick } from '../weighted-links/reference'
import type { GraphInput } from '../weighted-links/data'
import { collisionReference } from '../collision/reference'
import { COLLISION_EXACT_LIMIT } from '../collision/data'
import { collisionPassFrame } from '../collision/hashed-grid'
import { collisionSlotsReference } from '../collision/hashed-reference'
import { GRAVITY, REPULSION, SPRINGS, stagesFor, type Stage } from './data'
import { centerReference } from './center-reference'
import { repulsionMethod, type RepulsionPolicy } from './repulsion-policy'
import { forceSettings, validateForceSettings, type ForceSettings } from './production-settings'
const f = Math.fround
// Polar gravity is the legacy operation model. The intended linear force also has
// a Cartesian formulation; precision-diagnostics assesses it independently.
export function gravity (points: Float32Array, alpha: number, origin?: [number, number]): Snapshot {
  const forces = new Float32Array(points.length)
  for (let i = 0; i < points.length; i += 4) {
    const dx = f(origin ? f(origin[0]) - points[i] : -points[i]); const dy = f(origin ? f(origin[1]) - points[i + 1] : -points[i + 1])
    const distance = f(Math.sqrt(f(f(dx * dx) + f(dy * dy))))
    if (distance > 0) {
      const angle = f(Math.atan2(dy, dx)); const magnitude = f(f(f(f(alpha) * f(GRAVITY)) * distance) * f(0.1))
      forces[i] = f(magnitude * f(Math.cos(angle))); forces[i + 1] = f(magnitude * f(Math.sin(angle)))
    }
  }
  return { forces, positions: integrate(points, forces, REPULSION) }
}
export function createOracle (
  graph: GraphInput, input: Input, policy: RepulsionPolicy = 'hierarchical', settings: ForceSettings = forceSettings('reference', input.points.length / 4)
): {
  stage(stage: Stage, points: Float32Array, alpha: number, tick: number, collisionIteration?: number): Snapshot;
  tick(points: Float32Array, alpha: number, tick: number): Float32Array;
} {
  validateForceSettings(settings)
  const index = createReferenceIndex(graph)
  const stage = (name: Stage, points: Float32Array, alpha: number, tick: number, collisionIteration = 0): Snapshot => {
    if (name === 'gravity') return gravity(points, alpha, settings.origin)
    if (name === 'center') return centerReference(points, alpha, settings.center ?? 0)
    if (name === 'collision') {
      if (!settings.collision) throw new Error('Collision settings are required')
      if (settings.hashedCollision && points.length / 4 > COLLISION_EXACT_LIMIT) {
        return collisionSlotsReference(points, graph.sizes, settings.collision, settings.origin ?? [0, 0],
          collisionPassFrame(tick * settings.collision.iterations + collisionIteration, alpha))
      }
      return collisionReference(points, graph.sizes, settings.collision, alpha)
    }
    if (name === 'repulsion') {
      if (repulsionMethod(points.length / 4, policy) === 'exact') return exactTick(input, points, { ...REPULSION, alpha })
      const frame = frameFor(points, tick, settings.samples, settings.precise)
      return gridReference(input, points, { ...REPULSION, alpha }, frame, buildReference(points, frame))
    }
    // Evaluate the requested direction first on this stage's actual input.
    const result = springTick(graph, points, {
      ...SPRINGS,
      variation: settings.variation,
      alpha,
      collision: !!settings.collision?.strength,
      radius: settings.collision?.radius ?? 0,
      padding: settings.collision?.padding ?? 0,
    }, index, name === 'incoming' ? 0 : 1)
    return { forces: result.firstForce, positions: result.intermediate }
  }
  return {
    stage,
    tick (points, alpha, tick): Float32Array {
      let collisionIteration = 0
      for (const name of stagesFor(settings.center, settings.collision)) {
        points = stage(name, points, alpha, tick, name === 'collision' ? collisionIteration++ : 0).positions
      }
      return points
    },
  }
}
