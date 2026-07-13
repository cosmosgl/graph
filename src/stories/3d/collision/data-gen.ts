export type CollisionPointsData3D = {
  pointPositions: Float32Array;
  pointColors: Float32Array;
  pointSizes: Float32Array;
}

/**
 * Generates loose points with varied sizes scattered inside the `[0, spaceSize]³`
 * cube — gravity pulls them together and the collision force packs them into a
 * ball of non-overlapping spheres. Colors encode the point size (small = teal,
 * large = amber).
 */
export function generateCollisionPoints3D (
  pointsNumber = 600,
  spaceSize = 4096
): CollisionPointsData3D {
  const pointPositions = new Float32Array(pointsNumber * 3)
  const pointColors = new Float32Array(pointsNumber * 4)
  const pointSizes = new Float32Array(pointsNumber)

  for (let i = 0; i < pointsNumber; i += 1) {
    pointPositions[i * 3 + 0] = spaceSize * (0.2 + Math.random() * 0.6)
    pointPositions[i * 3 + 1] = spaceSize * (0.2 + Math.random() * 0.6)
    pointPositions[i * 3 + 2] = spaceSize * (0.2 + Math.random() * 0.6)

    // Mostly small spheres with a few large ones (t is size, biased small)
    const t = Math.pow(Math.random(), 2.5)
    pointSizes[i] = 40 + t * 480

    pointColors[i * 4 + 0] = 0.19 + t * 0.76
    pointColors[i * 4 + 1] = 0.75 - t * 0.07
    pointColors[i * 4 + 2] = 0.64 - t * 0.36
    pointColors[i * 4 + 3] = 1
  }

  return { pointPositions, pointColors, pointSizes }
}
