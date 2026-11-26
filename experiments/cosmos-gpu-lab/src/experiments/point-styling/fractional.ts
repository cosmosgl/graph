import type { StylingWebGL } from './webgl'
import { center, type Point, type Settings } from './data'

// Fit the horizontal sprite span from the change in local coordinates across two adjacent pixel centers.
export async function fractionalSpriteSpan (gl: StylingWebGL, points: Point[], settings: Settings): Promise<number | undefined> {
  const circle = points.find(p => p.size === 13.3)!
  const [cx, cy] = center(circle, settings)
  const samples = await gl.readSpriteCoordinates(points, settings, Math.floor(cx), Math.floor(cy))
  if (!samples[2] || !samples[6]) return undefined
  const step = samples[4] - samples[0]
  return step > 0 ? 2 / step : undefined
}
