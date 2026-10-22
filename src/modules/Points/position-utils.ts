import { isPointAbsent } from '@/graph/helper'

/**
 * A present point's coordinate as the GPU receives it, already rounded to
 * float32: an infinity is placed on the matching edge — `0` for `-Infinity`,
 * `infiniteEdge` for `+Infinity` (Store.infiniteInputEdge, today the width of
 * the space) — and every other value is kept. (NaN is not a coordinate: it
 * marks the point absent, which callers handle.)
 *
 * Every present position on the GPU is finite, and stays finite: the
 * simulation drops a non-finite step (update-position.frag). An infinite input
 * would break that from the first tick — it makes the many-body and collision
 * sums, and so every other point's forces, NaN, and no step could ever bring
 * the point back. The old position clamp mostly hid this by pulling such a
 * point back into the space at its first step; the matching edge keeps it in
 * the space too, on the side the input pointed to.
 */
export function toFiniteCoordinate (value: number, infiniteEdge: number): number {
  if (value === Infinity) return infiniteEdge
  if (value === -Infinity) return 0
  return value
}

/**
 * Build RGBA32F texture data from a flat `[x, y, x, y, ...]` point positions array.
 *
 * Layout per pixel: `[x, y, index, 0]`. The blue channel encodes the point index —
 * `drag-point.frag` reads it to match the drag target. Alpha is unused by shaders.
 * An infinite coordinate of a present point lands on `infiniteEdge`
 * (`toFiniteCoordinate`); the input array is not modified.
 */
export function buildPositionTextureData (
  pointPositions: Float32Array | undefined,
  pointsTextureSize: number,
  pointsNumber: number,
  infiniteEdge: number
): Float32Array {
  const positionData = new Float32Array(pointsTextureSize * pointsTextureSize * 4)
  if (!pointPositions) return positionData

  for (let i = 0; i < pointsNumber; ++i) {
    // Normalize a half-NaN position to fully NaN: absence is all-or-nothing by the
    // time it reaches the GPU, so shaders can test a single channel.
    const absent = isPointAbsent(pointPositions, i)
    positionData[i * 4 + 0] = absent ? NaN : toFiniteCoordinate(pointPositions[i * 2 + 0] as number, infiniteEdge)
    positionData[i * 4 + 1] = absent ? NaN : toFiniteCoordinate(pointPositions[i * 2 + 1] as number, infiniteEdge)
    positionData[i * 4 + 2] = i
  }

  return positionData
}

/**
 * Build the `sourcePosition` texture data for a transition when the point count changed.
 *
 * Shared indices (`0..sharedCount`) carry over their on-screen positions from
 * `previousPositionPixels` (readback of the pre-transition `currentPositionFbo`), so the
 * animation starts from where each point was last rendered. New indices (`sharedCount..targetCount`)
 * start at their target position so they don't drift in from the origin.
 *
 * Precondition: `sharedCount * 4 <= previousPositionPixels.length` — the caller guarantees
 * this by passing `min(previousPointsCount, targetCount)`.
 */
export function buildSourcePositionTextureData (
  previousPositionPixels: Float32Array,
  targetData: Float32Array,
  sharedCount: number,
  targetCount: number,
  newTextureSize: number
): Float32Array {
  const sourceData = new Float32Array(newTextureSize * newTextureSize * 4)

  for (let i = 0; i < sharedCount; i += 1) {
    sourceData[i * 4 + 0] = previousPositionPixels[i * 4 + 0] as number
    sourceData[i * 4 + 1] = previousPositionPixels[i * 4 + 1] as number
    sourceData[i * 4 + 2] = i
  }

  for (let i = sharedCount; i < targetCount; i += 1) {
    sourceData[i * 4 + 0] = targetData[i * 4 + 0] as number
    sourceData[i * 4 + 1] = targetData[i * 4 + 1] as number
    sourceData[i * 4 + 2] = i
  }

  return sourceData
}
