import type { Input, Parameters } from '../many-body/data'
import { nearLimit } from '../many-body/data'
import { compare, type Snapshot } from '../many-body/reference'
import { cellOf, layout, type Frame, type Structure } from './data'
const f = Math.fround
type Vec = [number, number]
function pair (dx: number, dy: number, rx: number, ry: number, mass: number, p: Parameters): Vec {
  dx = f(dx); dy = f(dy)
  let l = f(f(dx * dx) + f(dy * dy))
  if (l <= 0) { dx = rx; dy = ry; l = f(f(dx * dx) + f(dy * dy)) }
  if (l <= 0) return [0, 0]
  const direction = f(Math.sqrt(l)); if (l < 1) l = f(Math.sqrt(l))
  const magnitude = f(f(f(f(p.alpha) * f(p.repulsion)) * mass) / f(Math.sqrt(l)))
  return [f(magnitude * f(dx / direction)), f(magnitude * f(dy / direction))]
}
function add (a: Vec, b: Vec): Vec { return [f(a[0] + b[0]), f(a[1] + b[1])] }
function finishNear (near: Vec, rx: number, ry: number, limit: number): Vec {
  near = [f(near[0] + f(near[0] * rx)), f(near[1] + f(near[1] * ry))]
  const speed = f(Math.sqrt(f(f(near[0] * near[0]) + f(near[1] * near[1]))))
  if (speed > limit) { const scale = f(limit / speed); near = [f(near[0] * scale), f(near[1] * scale)] }
  return near
}
// Stage isolation: feed the GPU force readback into the scalar integrator.
export function integrate (points: Float32Array, forces: Float32Array, p: Parameters): Float32Array {
  const count = points.length / 4
  const output = points.slice()
  for (let i = 0; i < count; i++) {
    const o = i * 4
    if (points[o + 2] > 0.5 || points[o + 3] > 0.5 || !Number.isFinite(forces[o]) || !Number.isFinite(forces[o + 1])) continue
    const dx = f(forces[o] * f(p.friction)); const dy = f(forces[o + 1] * f(p.friction)); const length = Math.hypot(dx, dy)
    output[o] = f(points[o] + (length > p.referenceLength ? dx / length * p.referenceLength : dx))
    output[o + 1] = f(points[o + 1] + (length > p.referenceLength ? dy / length * p.referenceLength : dy))
  }
  return output
}
export function gridReference (input: Input, points: Float32Array, p: Parameters, frame: Frame, structure: Structure): Snapshot {
  const count = points.length / 4; const l = layout(count); const cells = l.finest ** 2
  const forces = new Float32Array(points.length)
  for (let target = 0; target < count; target++) {
    const offset = target * 4; if (points[offset + 3] > 0.5) continue
    const x = points[offset]; const y = points[offset + 1]
    let far: Vec = [0, 0]
    for (const [level, n] of l.sizes.entries()) {
      const c = cellOf(x, y, n, frame.bounds); const cx = c % n; const cy = Math.floor(c / n)
      const shell = frame.precise && level !== l.sizes.length - 1 ? 2 : 1
      const parent = frame.precise ? 2 : 1
      const width = level === 0 ? n : 2 * (2 * parent + 1)
      const bx = level === 0 ? 0 : Math.floor(cx / 2) * 2 - 2 * parent
      const by = level === 0 ? 0 : Math.floor(cy / 2) * 2 - 2 * parent
      let velocity: Vec = [0, 0]
      for (let j = 0; j < width; j++) {
        for (let i = 0; i < width; i++) {
          const xx = bx + i; const yy = by + j
          if (xx < 0 || yy < 0 || xx >= n || yy >= n || Math.max(Math.abs(xx - cx), Math.abs(yy - cy)) <= shell) continue
          const a = (l.offsets[level] + yy * n + xx) * 4; const mass = structure.aggregates[a + 2]
          if (!mass) continue
          velocity = add(velocity, pair(f(x - f(structure.aggregates[a] / mass)), f(y - f(structure.aggregates[a + 1] / mass)), 0, 0, mass, p))
        }
      }
      far = add(far, velocity)
    }
    const c = cellOf(x, y, l.finest, frame.bounds); const cx = c % l.finest; const cy = Math.floor(c / l.finest)
    const rx = input.samples[target * 2]; const ry = input.samples[target * 2 + 1]
    let near: Vec = [0, 0]
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const xx = cx + i; const yy = cy + j
        if (xx < 0 || yy < 0 || xx >= l.finest || yy >= l.finest) continue
        const cell = yy * l.finest + xx
        const others = structure.aggregates[(l.offsets[l.offsets.length - 1] + cell) * 4 + 2] - (i === 0 && j === 0 ? 1 : 0)
        if (others <= 0) continue
        let sampled = 0; let sum: Vec = [0, 0]
        for (let s = 0; s < frame.slots; s++) {
          const source = structure.slots[(s * cells + cell) * 2]
          if (source < 0) break
          if (source === target) continue
          sampled++
          sum = add(sum, pair(f(x - points[source * 4]), f(y - points[source * 4 + 1]), rx, ry, 1, p))
        }
        if (sampled) { const weight = f(others / sampled); near = add(near, [f(weight * sum[0]), f(weight * sum[1])]) }
      }
    }
    const force = add(far, finishNear(near, rx, ry, nearLimit(count, p)))
    forces.set(force, offset)
  }
  return { forces, positions: integrate(points, forces, p) }
}
// Production grid shaders don't define useful force outputs for absent targets;
// their positions are masked by integration. All present force components remain checked.
export function comparePresent (actual: Snapshot, expected: Snapshot, points: Float32Array): ReturnType<typeof compare> {
  const forces = actual.forces.slice(); const expectedForces = expected.forces.slice()
  for (let i = 0; i < points.length; i += 4) {
    if (points[i + 3] > 0.5) { forces.fill(0, i, i + 4); expectedForces.fill(0, i, i + 4) }
  }
  return compare({ ...actual, forces }, { ...expected, forces: expectedForces })
}
export function approximationError (input: Input, points: Float32Array, approximate: Float32Array, p: Parameters, frame: Frame): {
  targets: number; versusProductionExactPercent: number; versusExactGridPartitionPercent: number;
} {
  const n = points.length / 4; const finest = layout(n).finest; const limit = nearLimit(n, p)
  const sums = [0, 0]; const norms = [0, 0]; let targets = 0
  for (let t = 0; t < Math.min(64, n); t++) {
    const i = Math.floor(t * n / Math.min(64, n)); if (points[i * 4 + 3] > 0.5) continue
    targets++
    const x = points[i * 4]; const y = points[i * 4 + 1]; const rx = input.samples[i * 2]; const ry = input.samples[i * 2 + 1]
    const c = cellOf(x, y, finest, frame.bounds)
    const near: Vec[] = [[0, 0], [0, 0]]; const far: Vec[] = [[0, 0], [0, 0]]
    for (let j = 0; j < n; j++) {
      if (i === j || points[j * 4 + 3] > 0.5) continue
      const dx = f(x - points[j * 4]); const dy = f(y - points[j * 4 + 1])
      const velocity = pair(dx, dy, rx, ry, 1, p)
      const other = cellOf(points[j * 4], points[j * 4 + 1], finest, frame.bounds)
      const close = [f(f(dx * dx) + f(dy * dy)) < f(limit * limit),
        Math.max(Math.abs(c % finest - other % finest), Math.abs(Math.floor(c / finest) - Math.floor(other / finest))) <= 1]
      for (let k = 0; k < 2; k++) { if (close[k]) near[k] = add(near[k], velocity); else far[k] = add(far[k], velocity) }
    }
    for (let k = 0; k < 2; k++) {
      const exact = add(far[k], finishNear(near[k], rx, ry, limit))
      sums[k] += (approximate[i * 4] - exact[0]) ** 2 + (approximate[i * 4 + 1] - exact[1]) ** 2
      norms[k] += exact[0] ** 2 + exact[1] ** 2
    }
  }
  const percent = (k: number): number => norms[k] ? 100 * Math.sqrt(sums[k] / norms[k]) : sums[k] ? Infinity : 0
  return { targets, versusProductionExactPercent: percent(0), versusExactGridPartitionPercent: percent(1) }
}
