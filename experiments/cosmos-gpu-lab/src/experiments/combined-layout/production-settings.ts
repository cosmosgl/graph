import { getFinestGridSize, getNearFieldSlotCount } from '../../../../../src/modules/Shared/cell-slots'
import { COLLISION_ARITHMETICS, validateCollision, type CollisionParameters, type CollisionArithmetic } from '../collision/data'
import type { CenterReduction } from './center-reduction'
export type ForceSettings = {
  samples: number; variation: [number, number]; precise: boolean; origin?: [number, number]; center?: number;
  collision?: CollisionParameters; collisionArithmetic?: CollisionArithmetic; centerReduction?: CenterReduction;
}
export type ProductionPreset = 'reference' | 'samples32' | 'varied32' | 'adaptive'
export const PRESETS: Record<ProductionPreset, string> = {
  reference: 'Reference · 8 samples, fixed springs',
  samples32: '32 samples · fixed springs',
  varied32: '32 samples · production spring variation',
  adaptive: 'Adaptive samples · production spring variation',
}
export function forceSettings (preset: ProductionPreset, count: number): ForceSettings {
  if (!Object.hasOwn(PRESETS, preset)) throw new Error('Invalid production preset')
  return {
    samples: preset === 'reference' ? 8 : preset === 'adaptive' ? getNearFieldSlotCount(count) : 32,
    variation: preset === 'reference' || preset === 'samples32' ? [1, 1] : [1, 1.2],
    precise: preset === 'reference' || count <= 25000,
  }
}
export function validateForceSettings (s: ForceSettings): void {
  if (!Number.isInteger(s.samples) || s.samples < 1 || s.samples > 64 || s.variation.length !== 2 ||
    !s.variation.every(v => Number.isFinite(v) && v > 0) || s.variation[0] > s.variation[1]) throw new Error('Invalid force settings')
  if (s.origin && (s.origin.length !== 2 || !s.origin.every(Number.isFinite))) throw new Error('Invalid force origin')
  if (s.center !== undefined && (!Number.isFinite(s.center) || s.center < 0)) throw new Error('Invalid center force')
  if (s.centerReduction && !['f32', 'high-low'].includes(s.centerReduction)) throw new Error('Invalid center reduction')
  if (s.collision) validateCollision(s.collision)
  if (s.collisionArithmetic && !COLLISION_ARITHMETICS.includes(s.collisionArithmetic)) throw new Error('Invalid collision arithmetic')
}
export type Occupancy = { points: number; overflow: [number, number, number] }
// Mirrors ForceManyBody's occupancy decision and budgets, independently of the
// production WebGL module and its luma v9 dependency. Scheduling is recorded.
export function wantedSamples ({ points, overflow }: Occupancy): number {
  let samples = 8
  for (const over of overflow) { if (over <= 0.01 * points) return samples; samples *= 2 }
  return Math.min(samples, 64)
}
export function affordableSamples (count: number): number {
  const affordable = Math.min(1.6e6 / Math.max(1, count), 32 * 1024 * 1024 / (getFinestGridSize(count) ** 2 * 8))
  return Math.min(64, Math.max(8, 2 ** Math.floor(Math.log2(affordable))))
}
export function createSamplingPolicy (count: number): {
  readonly samples: number; collect(stats: Occupancy): { wanted: number; applied: number; changed: boolean };
} {
  let measured: number | undefined; let proposed: number | undefined
  const current = (): number => Math.min(measured ?? getNearFieldSlotCount(count), affordableSamples(count))
  return {
    get samples (): number { return current() },
    collect (stats): { wanted: number; applied: number; changed: boolean } {
      if (![stats.points, ...stats.overflow].every(v => Number.isInteger(v) && v >= 0 && v <= stats.points) ||
        stats.overflow[1] > stats.overflow[0] || stats.overflow[2] > stats.overflow[1]) throw new Error('Invalid occupancy')
      if (stats.points === 0) return { wanted: current(), applied: current(), changed: false }
      const before = current(); const wanted = wantedSamples(stats)
      if (measured === undefined || wanted === proposed) { measured = wanted; proposed = undefined } else if (wanted !== measured) proposed = wanted
      else proposed = undefined
      return { wanted, applied: current(), changed: before !== current() }
    },
  }
}
