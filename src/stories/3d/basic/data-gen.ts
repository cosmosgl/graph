export type GraphData3D = {
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
]

/**
 * Gaussian-ish random value in [-1, 1] (average of three uniforms, centered).
 */
const randomSpread = (): number => (Math.random() + Math.random() + Math.random()) / 1.5 - 1

/**
 * Generates points grouped into spherical 3D clusters inside the `[0, spaceSize]³` cube,
 * with chain-like links inside each cluster and a few links between the cluster seeds.
 */
export function generateClusters3D (
  pointsNumber = 10000,
  clustersNumber = 5,
  spaceSize = 4096
): GraphData3D {
  const pointPositions = new Float32Array(pointsNumber * 3)
  const pointColors = new Float32Array(pointsNumber * 4)
  const links: number[] = []

  const clusterCenters: [number, number, number][] = []
  for (let c = 0; c < clustersNumber; c += 1) {
    // Cluster centers on a ring tilted into the third dimension, so no pair of
    // clusters overlaps from the default viewing angle.
    const angle = (c / clustersNumber) * Math.PI * 2
    clusterCenters.push([
      spaceSize * (0.5 + 0.3 * Math.cos(angle)),
      spaceSize * (0.5 + 0.3 * Math.sin(angle)),
      spaceSize * (0.5 + 0.3 * Math.sin(angle * 2)),
    ])
  }

  const clusterRadius = spaceSize * 0.12
  const firstPointOfCluster: number[] = []
  for (let i = 0; i < pointsNumber; i += 1) {
    const cluster = i % clustersNumber
    if (firstPointOfCluster[cluster] === undefined) firstPointOfCluster[cluster] = i
    const center = clusterCenters[cluster] as [number, number, number]
    pointPositions[i * 3 + 0] = center[0] + randomSpread() * clusterRadius
    pointPositions[i * 3 + 1] = center[1] + randomSpread() * clusterRadius
    pointPositions[i * 3 + 2] = center[2] + randomSpread() * clusterRadius

    const color = clusterPalette[cluster % clusterPalette.length] as [number, number, number, number]
    pointColors[i * 4 + 0] = color[0]
    pointColors[i * 4 + 1] = color[1]
    pointColors[i * 4 + 2] = color[2]
    pointColors[i * 4 + 3] = color[3]

    // Link each point to a random earlier point of the same cluster.
    if (i >= clustersNumber) {
      const stepsBack = 1 + Math.floor(Math.random() * Math.min(20, Math.floor(i / clustersNumber)))
      links.push(i, i - stepsBack * clustersNumber)
    }
  }

  // A few inter-cluster links between the cluster seed points.
  for (let c = 0; c < clustersNumber; c += 1) {
    links.push(
      firstPointOfCluster[c] as number,
      firstPointOfCluster[(c + 1) % clustersNumber] as number
    )
  }

  return { pointPositions, pointColors, links: new Float32Array(links) }
}

/**
 * Alternative layout for the same points: everything on the surface of a sphere.
 * Used to demonstrate animated 3D position transitions.
 */
export function generateSphereLayout3D (pointsNumber: number, spaceSize = 4096): Float32Array {
  const pointPositions = new Float32Array(pointsNumber * 3)
  const radius = spaceSize * 0.4
  for (let i = 0; i < pointsNumber; i += 1) {
    // Fibonacci sphere: evenly distributed points on the surface.
    const t = (i + 0.5) / pointsNumber
    const inclination = Math.acos(1 - 2 * t)
    const azimuth = Math.PI * (1 + Math.sqrt(5)) * i
    pointPositions[i * 3 + 0] = spaceSize / 2 + radius * Math.sin(inclination) * Math.cos(azimuth)
    pointPositions[i * 3 + 1] = spaceSize / 2 + radius * Math.cos(inclination)
    pointPositions[i * 3 + 2] = spaceSize / 2 + radius * Math.sin(inclination) * Math.sin(azimuth)
  }
  return pointPositions
}
