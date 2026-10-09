import { Graph, getRgbaColor } from '@cosmos.gl/graph'
import { scaleSequential } from 'd3-scale'
import { interpolateRainbow } from 'd3-scale-chromatic'
import { createCosmos } from '../create-cosmos'

function getRandom (min: number, max: number): number {
  return Math.random() * (max - min) + min
}

/**
 * Several star-shaped clusters: one hub per cluster, linked to every one of
 * its leaves. The springs pull each cluster into a pile on top of its hub,
 * and only the collision force holds the leaves apart. Every leaf is seeded
 * near its hub, so the simulation starts from the worst case — a deep pile —
 * and the clusters have to inflate against the inward pull.
 */
export const hubClusters = (): { graph: Graph; div: HTMLDivElement } => {
  const numClusters = 7
  const spaceCenter = 2048
  const ringRadius = 1100
  const hubSize = 30
  const seedRadius = 20 // leaves start this close to their hub: a pile

  const clusterColorScale = scaleSequential(interpolateRainbow).domain([0, numClusters])

  const positions: number[] = []
  const sizes: number[] = []
  const colors: number[] = []
  const links: number[] = []

  const addPoint = (x: number, y: number, size: number, cluster: number): number => {
    const index = sizes.length
    positions.push(x, y)
    sizes.push(size)
    const rgba = getRgbaColor(clusterColorScale(cluster))
    colors.push(rgba[0], rgba[1], rgba[2], 1)
    return index
  }

  for (let c = 0; c < numClusters; c++) {
    const angle = (c / numClusters) * Math.PI * 2
    const cx = spaceCenter + Math.cos(angle) * ringRadius
    const cy = spaceCenter + Math.sin(angle) * ringRadius

    const hub = addPoint(cx, cy, hubSize, c)

    // 60–140 leaves per hub, sized unevenly so the packing is irregular
    const leafCount = Math.round(getRandom(60, 140))
    const leaves: number[] = []
    for (let i = 0; i < leafCount; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * seedRadius
      const leaf = addPoint(cx + Math.cos(a) * r, cy + Math.sin(a) * r, getRandom(6, 16), c)
      leaves.push(leaf)
      links.push(hub, leaf)
    }

    // A few leaf-to-leaf links, so the cluster is a graph and not only a star
    for (const leaf of leaves) {
      if (Math.random() < 0.15) {
        const other = leaves[Math.floor(Math.random() * leaves.length)] as number
        if (other !== leaf) links.push(leaf, other)
      }
    }
  }

  const linkCount = links.length / 2
  const linkColors = new Float32Array(linkCount * 4)
  for (let i = 0; i < linkCount; i++) {
    const source = links[i * 2] as number
    linkColors[i * 4] = colors[source * 4] as number
    linkColors[i * 4 + 1] = colors[source * 4 + 1] as number
    linkColors[i * 4 + 2] = colors[source * 4 + 2] as number
    linkColors[i * 4 + 3] = 0.25
  }

  return createCosmos({
    pointPositions: new Float32Array(positions),
    pointSizes: new Float32Array(sizes),
    pointColors: new Float32Array(colors),
    links: new Float32Array(links),
    linkColors,
    linkDefaultWidth: 0.6,
    // Collision radii come from the point sizes. 75 under-relaxed passes per
    // tick (strength 0.75): the hubs' springs re-pile the leaves every tick,
    // and the extra passes unwind the pile faster than the springs rebuild it.
    // With fewer than 4,096 points each pass is an exact all-pairs sweep, so
    // this story spends frame time on packing quality.
    simulationCollision: 0.75,
    simulationCollisionPadding: 1,
    simulationCollisionRadius: undefined,
    simulationCollisionIterations: 75,
    // The springs are strong and ask for a distance far inside the contact
    // range. While collision is on, the engine floors each link's rest length
    // at the two endpoints' combined radii, so the springs stop at contact
    // instead of pulling the leaves into the hub.
    simulationLinkSpring: 1,
    simulationLinkDistance: 5,
    simulationLinkDistRandomVariationRange: [1, 1],
    // Weak repulsion: collision, not many-body, is what spaces the leaves.
    // Gravity holds the (unconnected) clusters together and in view.
    simulationRepulsion: 0.5,
    simulationGravity: 0.35,
    simulationCluster: 0,
    // The springs fade with alpha; collision does not. While the simulation
    // is hot, a hundred springs per hub compress the outer shells of leaves;
    // as it cools, collision takes over and the shells unpack. A moderate
    // decay keeps that hand-over watchable within a minute.
    simulationDecay: 5000,
    simulationFriction: 0.85,
    fitViewOnInit: false,
  })
}
