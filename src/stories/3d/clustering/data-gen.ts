export type ClusteredPointsData3D = {
  pointPositions: Float32Array;
  pointColors: Float32Array;
  pointClusters: number[];
  clustersNumber: number;
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
 * Generates unlinked points randomly assigned to clusters, scattered inside the
 * `[0, spaceSize]³` cube. The cluster force gathers each cluster into its own
 * blob (at the cluster's centermass by default), while many-body repulsion keeps
 * the blobs apart from each other.
 */
export function generateClusteredPoints3D (
  pointsNumber = 4000,
  clustersNumber = 6,
  spaceSize = 4096
): ClusteredPointsData3D {
  const pointPositions = new Float32Array(pointsNumber * 3)
  const pointColors = new Float32Array(pointsNumber * 4)
  const pointClusters: number[] = []

  for (let i = 0; i < pointsNumber; i += 1) {
    pointPositions[i * 3 + 0] = spaceSize * (0.25 + Math.random() * 0.5)
    pointPositions[i * 3 + 1] = spaceSize * (0.25 + Math.random() * 0.5)
    pointPositions[i * 3 + 2] = spaceSize * (0.25 + Math.random() * 0.5)

    const cluster = i % clustersNumber
    pointClusters.push(cluster)
    const color = clusterPalette[cluster % clusterPalette.length] as [number, number, number, number]
    pointColors[i * 4 + 0] = color[0]
    pointColors[i * 4 + 1] = color[1]
    pointColors[i * 4 + 2] = color[2]
    pointColors[i * 4 + 3] = color[3]
  }

  return { pointPositions, pointColors, pointClusters, clustersNumber }
}
