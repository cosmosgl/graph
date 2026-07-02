export type LatticeGraphData3D = {
  pointPositions: Float32Array;
  pointColors: Float32Array;
  links: Float32Array;
}

/**
 * Generates a k × k × k cube lattice: every point links to its +x, +y and +z
 * neighbors. Initial positions are random inside the `[0, spaceSize]³` cube — the
 * 3D force simulation untangles them and folds the graph back into a cube.
 * Points are colored by their lattice coordinates (position in the cube = RGB).
 */
export function generateCubeLattice3D (k = 12, spaceSize = 4096): LatticeGraphData3D {
  const pointsNumber = k * k * k
  const pointPositions = new Float32Array(pointsNumber * 3)
  const pointColors = new Float32Array(pointsNumber * 4)
  const links: number[] = []

  const index = (x: number, y: number, z: number): number => x + k * (y + k * z)

  for (let z = 0; z < k; z += 1) {
    for (let y = 0; y < k; y += 1) {
      for (let x = 0; x < k; x += 1) {
        const i = index(x, y, z)
        pointPositions[i * 3 + 0] = spaceSize * (0.25 + Math.random() * 0.5)
        pointPositions[i * 3 + 1] = spaceSize * (0.25 + Math.random() * 0.5)
        pointPositions[i * 3 + 2] = spaceSize * (0.25 + Math.random() * 0.5)

        pointColors[i * 4 + 0] = 0.35 + 0.6 * (x / (k - 1))
        pointColors[i * 4 + 1] = 0.35 + 0.6 * (y / (k - 1))
        pointColors[i * 4 + 2] = 0.35 + 0.6 * (z / (k - 1))
        pointColors[i * 4 + 3] = 1

        if (x + 1 < k) links.push(i, index(x + 1, y, z))
        if (y + 1 < k) links.push(i, index(x, y + 1, z))
        if (z + 1 < k) links.push(i, index(x, y, z + 1))
      }
    }
  }

  return { pointPositions, pointColors, links: new Float32Array(links) }
}
