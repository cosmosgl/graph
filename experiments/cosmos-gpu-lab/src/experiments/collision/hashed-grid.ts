import { collisionRotationSeed } from '../../../../../src/modules/ForceCollision/collision-grid'
import { getFinestGridSize, getNearFieldSlotCount } from '../../../../../src/modules/Shared/cell-slots'
import { validateCollision, type CollisionParameters } from './data'

export type CollisionOrigin = readonly [number, number]
export type CollisionSlotFrame = { tick: number; seed: number; alpha: number }

export function collisionSlotGrid (sizes: Float32Array, settings: CollisionParameters, origin: CollisionOrigin): {
  edge: number; capacity: number; cellsPerUnit: number;
} {
  validateCollision(settings)
  if (sizes.length <= 4096 || sizes.length > 8192 ||
    !sizes.every(size => Number.isFinite(size) && size >= 0) || !origin.every(Number.isFinite)) {
    throw new Error('The collision slot experiment covers 4,097–8,192 points with resolved sizes and a finite origin')
  }
  const maxSize = sizes.reduce((largest, size) => Math.max(largest, size), 0)
  const maxRadius = (settings.radius > 0 ? settings.radius : maxSize * 0.5) + settings.padding
  return {
    edge: getFinestGridSize(sizes.length),
    capacity: getNearFieldSlotCount(sizes.length),
    cellsPerUnit: Math.fround(1 / Math.max(2 * maxRadius, 8)),
  }
}

export function collisionSlotUniforms (
  count: number, grid: ReturnType<typeof collisionSlotGrid>, origin: CollisionOrigin, frame: CollisionSlotFrame
): Uint32Array {
  if (!Number.isInteger(frame.tick) || frame.tick < 0 || !Number.isFinite(frame.alpha) || frame.alpha < 0 ||
    !Number.isFinite(frame.seed) || frame.seed < 0 || frame.seed >= 1) throw new Error('Invalid collision slot frame')
  const words = new Uint32Array([count, grid.edge, grid.capacity, collisionRotationSeed(frame.tick), 0, 0, 0, 0])
  new Float32Array(words.buffer).set([...origin, grid.cellsPerUnit, frame.seed], 4)
  return words
}
