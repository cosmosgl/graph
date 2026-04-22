/**
 * Build RGBA32F texture data from a flat `[x, y, x, y, ...]` point positions array.
 *
 * Layout per pixel: `[x, y, index, 0]`. The blue channel encodes the point index —
 * `drag-point.frag` reads it to match the drag target. Alpha is unused by shaders.
 */
export function buildPositionTextureData (
  pointPositions: Float32Array | undefined,
  pointsTextureSize: number,
  pointsNumber: number
): Float32Array {
  const positionData = new Float32Array(pointsTextureSize * pointsTextureSize * 4)
  if (!pointPositions) return positionData

  for (let i = 0; i < pointsNumber; ++i) {
    positionData[i * 4 + 0] = pointPositions[i * 2 + 0] as number
    positionData[i * 4 + 1] = pointPositions[i * 2 + 1] as number
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
