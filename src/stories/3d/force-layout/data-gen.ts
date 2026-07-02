export type SimulationGraphData3D = {
  pointPositions: Float32Array;
  pointColors: Float32Array;
  links: Float32Array;
}

const clusterPalette: [number, number, number, number][] = [
  [0.945, 0.412, 0.706, 1], // pink
  [0.294, 0.357, 0.749, 1], // indigo
  [0.192, 0.749, 0.639, 1], // teal
  [0.949, 0.682, 0.278, 1], // amber
  [0.643, 0.475, 0.898, 1], // purple
  [0.408, 0.741, 0.914, 1], // sky
]

/**
 * Generates a clustered small-world graph with random initial positions inside the
 * `[0, spaceSize]³` cube — the 3D force simulation finds the layout. Each cluster is a
 * hub-and-spoke with extra random intra-cluster links; hubs are chained into a ring.
 */
export function generateClusteredGraph3D (
  pointsNumber = 3000,
  clustersNumber = 6,
  spaceSize = 4096
): SimulationGraphData3D {
  const pointPositions = new Float32Array(pointsNumber * 3)
  const pointColors = new Float32Array(pointsNumber * 4)
  const links: number[] = []

  for (let i = 0; i < pointsNumber; i += 1) {
    // Random initial positions — the layout emerges from the simulation.
    pointPositions[i * 3 + 0] = spaceSize * (0.25 + Math.random() * 0.5)
    pointPositions[i * 3 + 1] = spaceSize * (0.25 + Math.random() * 0.5)
    pointPositions[i * 3 + 2] = spaceSize * (0.25 + Math.random() * 0.5)

    const cluster = i % clustersNumber
    const color = clusterPalette[cluster % clusterPalette.length] as [number, number, number, number]
    pointColors[i * 4 + 0] = color[0]
    pointColors[i * 4 + 1] = color[1]
    pointColors[i * 4 + 2] = color[2]
    pointColors[i * 4 + 3] = color[3]

    // The first `clustersNumber` points are the hubs; every other point links to a
    // random earlier point of its own cluster (preferring the hub for a star shape).
    if (i >= clustersNumber) {
      const earlierCount = Math.floor((i - cluster) / clustersNumber)
      const pick = Math.random() < 0.6 ? 0 : Math.floor(Math.random() * earlierCount)
      links.push(i, cluster + clustersNumber * pick)
    }
  }

  // Chain the hubs into a ring so clusters stay connected.
  for (let c = 0; c < clustersNumber; c += 1) {
    links.push(c, (c + 1) % clustersNumber)
  }

  return { pointPositions, pointColors, links: new Float32Array(links) }
}
