import { COLLISION_ROTATIONS, collisionRotationSeed } from '../../../../../src/modules/ForceCollision/collision-grid'
import { integrate } from '../many-body-grid/reference'
import { radius, type CollisionParameters } from './data'
import { collisionSlotGrid, type CollisionOrigin, type CollisionSlotFrame } from './hashed-grid'

const f = Math.fround

function peelHash (index: number, seedBits: number): number {
  let h = index ^ seedBits
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h = (h ^ (h >>> 16)) >>> 8
  const normalized = f(f(h + 0.5) / 16777216)
  return f(f(0.001) + f(normalized * f(0.998)))
}

export function collisionSlotsReference (
  points: Float32Array, sizes: Float32Array, settings: CollisionParameters, origin: CollisionOrigin, frame: CollisionSlotFrame
): { slots: Uint32Array; forces: Float32Array; positions: Float32Array; maxOccupancy: number; overflow: number; aliases: number; ties: number } {
  const { edge, capacity, cellsPerUnit } = collisionSlotGrid(sizes, settings, origin)
  const count = sizes.length
  if (points.length !== count * 4) throw new Error('Collision slot positions and sizes disagree')
  const seed = new Uint32Array(new Float32Array([frame.seed]).buffer)[0]
  const rotationSeed = collisionRotationSeed(frame.tick)
  const anchoredCell = (position: number, axis: number): number =>
    Math.max(-16777216, Math.min(16777216, Math.floor(f(f(position - f(origin[axis])) * cellsPerUnit))))
  const rotation = (block: number, [a, b]: readonly [number, number]): number =>
    (Math.imul(Math.imul(a, block), block) + Math.imul(b + rotationSeed, block)) & (edge - 1)
  const bucketOf = (x: number, y: number): number => {
    const wrappedX = (x + rotation(Math.floor(y / edge), COLLISION_ROTATIONS[0])) & (edge - 1)
    const wrappedY = (y + rotation(Math.floor(x / edge), COLLISION_ROTATIONS[1])) & (edge - 1)
    return wrappedY * edge + wrappedX
  }
  const cells = new Int32Array(count * 2)
  const buckets = new Map<number, Array<{ index: number; hash: number }>>()
  for (let index = 0; index < count; index++) {
    const point = index * 4
    if (points[point + 3] > 0.5) continue
    const x = anchoredCell(points[point], 0)
    const y = anchoredCell(points[point + 1], 1)
    cells.set([x, y], index * 2)
    const key = bucketOf(x, y)
    const member = { index, hash: peelHash(index, seed) }
    const members = buckets.get(key)
    if (members) members.push(member)
    else buckets.set(key, [member])
  }
  const slots = new Uint32Array(edge ** 2 * capacity)
  let maxOccupancy = 0; let overflow = 0; let aliases = 0; let ties = 0
  for (const [bucket, members] of buckets) {
    maxOccupancy = Math.max(maxOccupancy, members.length)
    if (members.length > capacity) overflow++
    const first = members[0].index * 2
    if (members.some(({ index }) => cells[index * 2] !== cells[first] || cells[index * 2 + 1] !== cells[first + 1])) aliases++
    let written = 0
    let previous = -1
    for (const { index, hash } of members.sort((a, b) => a.hash - b.hash || a.index - b.index)) {
      if (hash === previous) { ties++; continue }
      previous = hash
      if (written < capacity) slots[bucket * capacity + written++] = index + 1
    }
  }
  const forces = new Float32Array(points.length)
  const radii = sizes.map(size => radius(size, settings))
  const cooling = settings.cooling > 0 ? f(Math.pow(Math.max(f(frame.alpha), 0), f(settings.cooling))) : 1
  const strength = f(f(settings.strength) * cooling)
  for (let index = 0; index < count; index++) {
    const point = index * 4
    if (points[point + 3] > 0.5) continue
    const ownRadius = radii[index]; const ownSquare = f(ownRadius * ownRadius)
    let horizontal = 0; let vertical = 0
    for (let y = cells[index * 2 + 1] - 1; y <= cells[index * 2 + 1] + 1; y++) {
      for (let x = cells[index * 2] - 1; x <= cells[index * 2] + 1; x++) {
        const base = bucketOf(x, y) * capacity
        for (let slot = 0; slot < capacity; slot++) {
          const other = slots[base + slot] - 1
          if (other < 0) break
          if (other === index || cells[other * 2] !== x || cells[other * 2 + 1] !== y) continue
          const dx = f(points[point] - points[other * 4]); const dy = f(points[point + 1] - points[other * 4 + 1])
          const squaredDistance = f(f(dx * dx) + f(dy * dy))
          const contact = f(ownRadius + radii[other])
          if (squaredDistance >= f(contact * contact)) continue
          let distance = f(Math.sqrt(squaredDistance))
          let ux: number; let uy: number
          if (distance > f(1e-4)) {
            ux = f(dx / distance); uy = f(dy / distance)
          } else {
            const angle = f(index * f(2.399963229728653))
            ux = f(Math.cos(angle)); uy = f(Math.sin(angle)); distance = 0
          }
          const otherSquare = f(radii[other] * radii[other])
          const weight = f(f(f(contact - distance) * otherSquare) / f(ownSquare + otherSquare))
          horizontal = f(horizontal + f(ux * weight)); vertical = f(vertical + f(uy * weight))
        }
      }
    }
    horizontal = f(horizontal * strength); vertical = f(vertical * strength)
    const speed = f(Math.sqrt(f(f(horizontal * horizontal) + f(vertical * vertical))))
    const scale = speed > ownRadius ? f(ownRadius / speed) : 1
    forces[point] = f(horizontal * scale); forces[point + 1] = f(vertical * scale)
  }
  const positions = integrate(points, forces, { alpha: frame.alpha, repulsion: 0, friction: 1, referenceLength: 4096 })
  return { slots, forces, positions, maxOccupancy, overflow, aliases, ties }
}
