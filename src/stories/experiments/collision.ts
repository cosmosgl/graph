import { Graph, getRgbaColor } from '@cosmos.gl/graph'
import { scaleSequential } from 'd3-scale'
import { interpolateRainbow } from 'd3-scale-chromatic'
import { createCosmos } from '../create-cosmos'

function getRandom (min: number, max: number): number {
  return Math.random() * (max - min) + min
}

export const collision = (): { graph: Graph; div: HTMLDivElement } => {
  // Build a clustered network so the collision force has a graph-like
  // structure to spread apart (instead of a featureless blob).
  const numClusters = 6
  const numPoints = 600
  const spaceCenter = 4096

  const clusterColorScale = scaleSequential(interpolateRainbow).domain([0, numClusters])

  const pointPositions = new Float32Array(numPoints * 2)
  const pointSizes = new Float32Array(numPoints)
  const pointColors = new Float32Array(numPoints * 4)
  const pointCluster = new Array<number>(numPoints)
  const degree = new Array<number>(numPoints).fill(0)

  // Spread cluster centers around a wide ring so the clusters start
  // well separated (close to the resolved layout) rather than piled on
  // top of each other at the centre.
  const clusterRingRadius = 1500
  const clusterCenters: [number, number][] = []
  for (let c = 0; c < numClusters; c++) {
    const angle = (c / numClusters) * Math.PI * 2
    clusterCenters.push([
      spaceCenter + Math.cos(angle) * clusterRingRadius,
      spaceCenter + Math.sin(angle) * clusterRingRadius,
    ])
  }

  // Assign points to clusters and seed positions spread out around each
  // cluster centre, so they begin mostly non-overlapping and the
  // simulation barely has to move them on start-up.
  for (let i = 0; i < numPoints; i++) {
    const cluster = i % numClusters
    pointCluster[i] = cluster
    const [cx, cy] = clusterCenters[cluster]
    const angle = Math.random() * Math.PI * 2
    const radius = Math.sqrt(Math.random()) * 550
    pointPositions[i * 2] = cx + Math.cos(angle) * radius
    pointPositions[i * 2 + 1] = cy + Math.sin(angle) * radius
  }

  // Build links: mostly intra-cluster (a few neighbours each), plus a
  // sprinkle of inter-cluster bridges. Track degree to size the points.
  const links: number[] = []
  const addLink = (a: number, b: number): void => {
    if (a === b) return
    links.push(a, b)
    degree[a] += 1
    degree[b] += 1
  }

  // Group point indices by cluster for easy intra-cluster wiring
  const byCluster: number[][] = Array.from({ length: numClusters }, () => [])
  for (let i = 0; i < numPoints; i++) byCluster[pointCluster[i]].push(i)

  for (const members of byCluster) {
    for (const point of members) {
      // Connect to ~1 random other member of the same cluster (occasionally 2),
      // keeping the graph sparse enough for collision to spread it out.
      const connections = Math.random() < 0.3 ? 2 : 1
      for (let k = 0; k < connections; k++) {
        const other = members[Math.floor(Math.random() * members.length)]
        addLink(point, other)
      }
    }
  }

  // A few bridges between clusters
  for (let i = 0; i < numPoints; i++) {
    if (Math.random() < 0.02) {
      const other = Math.floor(Math.random() * numPoints)
      if (pointCluster[other] !== pointCluster[i]) addLink(i, other)
    }
  }

  // Sizes scale with degree so hubs are visibly larger; collision uses sizes
  const maxDegree = Math.max(1, ...degree)
  for (let i = 0; i < numPoints; i++) {
    const hubness = degree[i] / maxDegree
    pointSizes[i] = 4 + hubness * 24 + Math.random() * 5

    const rgba = getRgbaColor(clusterColorScale(pointCluster[i]))
    pointColors[i * 4] = rgba[0]
    pointColors[i * 4 + 1] = rgba[1]
    pointColors[i * 4 + 2] = rgba[2]
    pointColors[i * 4 + 3] = 1
  }

  // Colour each link by its source point's cluster, with a low alpha
  const linkCount = links.length / 2
  const linkColors = new Float32Array(linkCount * 4)
  const linkWidths = new Float32Array(linkCount)
  for (let i = 0; i < linkCount; i++) {
    const source = links[i * 2]
    const rgba = getRgbaColor(clusterColorScale(pointCluster[source]))
    linkColors[i * 4] = rgba[0]
    linkColors[i * 4 + 1] = rgba[1]
    linkColors[i * 4 + 2] = rgba[2]
    linkColors[i * 4 + 3] = 0.3
    linkWidths[i] = getRandom(0.3, 1.2)
  }

  return createCosmos({
    pointPositions,
    pointSizes,
    pointColors,
    links: new Float32Array(links),
    linkColors,
    linkWidths,
    simulationCollision: 1,
    simulationCollisionRadius: 0, // Use point sizes for collision radius
    simulationRepulsion: 0.4,
    simulationGravity: 0.05,
    // Link distance must clear the points' collision radii (sizes up to ~30),
    // otherwise the spring pulls connected points into an unresolvable pile.
    simulationLinkSpring: 0.3,
    simulationLinkDistance: 30,
    simulationDecay: 30000,
    simulationFriction: 0.85,
    fitViewOnInit: true,
    fitViewDelay: 500,
  })
}
