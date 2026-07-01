/**
 * Build RGBA32F texture data from a flat point positions array:
 * `[x, y, x, y, ...]` when `dimensions` is `2`, `[x, y, z, x, y, z, ...]` when `3`.
 *
 * Layout per pixel: `[x, y, index, z]`. The blue channel encodes the point index —
 * `drag-point.frag` reads it to match the drag target. Alpha holds the z coordinate
 * (`0` in 2D mode, where no shader reads it).
 */
export function buildPositionTextureData (
  pointPositions: Float32Array | undefined,
  pointsTextureSize: number,
  pointsNumber: number,
  dimensions: 2 | 3 = 2
): Float32Array {
  const positionData = new Float32Array(pointsTextureSize * pointsTextureSize * 4)
  if (!pointPositions) return positionData

  for (let i = 0; i < pointsNumber; ++i) {
    positionData[i * 4 + 0] = pointPositions[i * dimensions + 0] as number
    positionData[i * 4 + 1] = pointPositions[i * dimensions + 1] as number
    positionData[i * 4 + 2] = i
    positionData[i * 4 + 3] = dimensions === 3 ? pointPositions[i * 3 + 2] as number : 0
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
    sourceData[i * 4 + 3] = previousPositionPixels[i * 4 + 3] as number
  }

  for (let i = sharedCount; i < targetCount; i += 1) {
    sourceData[i * 4 + 0] = targetData[i * 4 + 0] as number
    sourceData[i * 4 + 1] = targetData[i * 4 + 1] as number
    sourceData[i * 4 + 2] = i
    sourceData[i * 4 + 3] = targetData[i * 4 + 3] as number
  }

  return sourceData
}
