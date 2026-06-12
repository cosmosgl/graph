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

  // Spread cluster centers around a ring
  const clusterCenters: [number, number][] = []
  for (let c = 0; c < numClusters; c++) {
    const angle = (c / numClusters) * Math.PI * 2
    clusterCenters.push([
      spaceCenter + Math.cos(angle) * 600,
      spaceCenter + Math.sin(angle) * 600,
    ])
  }

  // Assign points to clusters and seed positions near the cluster center
  for (let i = 0; i < numPoints; i++) {
    const cluster = i % numClusters
    pointCluster[i] = cluster
    const [cx, cy] = clusterCenters[cluster]
    const angle = Math.random() * Math.PI * 2
    const radius = Math.abs((Math.random() + Math.random() + Math.random()) / 3) * 300
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
      // Connect to 1-3 random other members of the same cluster
      const connections = 1 + Math.floor(Math.random() * 3)
      for (let k = 0; k < connections; k++) {
        const other = members[Math.floor(Math.random() * members.length)]
        addLink(point, other)
      }
    }
  }

  // A handful of bridges between clusters
  for (let i = 0; i < numPoints; i++) {
    if (Math.random() < 0.04) {
      const other = Math.floor(Math.random() * numPoints)
      if (pointCluster[other] !== pointCluster[i]) addLink(i, other)
    }
  }

  // Sizes scale with degree so hubs are visibly larger; collision uses sizes
  const maxDegree = Math.max(1, ...degree)
  for (let i = 0; i < numPoints; i++) {
    const hubness = degree[i] / maxDegree
    pointSizes[i] = 4 + hubness * 40 + Math.random() * 8

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
    simulationCollision: 0.6,
    simulationCollisionRadius: 0, // Use point sizes for collision radius
    simulationRepulsion: 0.3,
    simulationGravity: 0.1,
    simulationLinkSpring: 0.6,
    simulationLinkDistance: 8,
    simulationDecay: 100000,
    simulationFriction: 0.6,
    fitViewOnInit: true,
    fitViewDelay: 250,
  })
}
