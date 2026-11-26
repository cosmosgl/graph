import { comparePixels } from '../../runtime/compare-pixels'
import type { CollisionSnapshot } from './frame'

export function compareCollision (webgl: CollisionSnapshot, webgpu: CollisionSnapshot, mask?: ImageData): {
  positionMismatches: number; maxPositionDelta: number; differingPixels: number; totalPixels: number; maxChannelDelta: number;
} {
  if (webgl.tick !== webgpu.tick) throw new Error('The graphs are at different simulation ticks')
  const a = webgl.positions
  const b = webgpu.positions
  if (a.length !== b.length || a.length % 2) throw new Error('The graphs returned incompatible position arrays')
  let positionMismatches = 0
  let maxPositionDelta = 0
  for (let i = 0; i < a.length; i += 2) {
    if (Number.isNaN(a[i]) && Number.isNaN(a[i + 1]) && Number.isNaN(b[i]) && Number.isNaN(b[i + 1])) continue
    const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]))
    if (delta !== 0) positionMismatches++
    maxPositionDelta = Math.max(maxPositionDelta, Number.isFinite(delta) ? delta : Infinity)
  }
  return { positionMismatches, maxPositionDelta, ...comparePixels(webgl.pixels, webgpu.pixels, mask) }
}
