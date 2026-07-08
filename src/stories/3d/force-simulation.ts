import { Graph, type GraphConfig } from '@cosmos.gl/graph'

/**
 * 3D force simulation: a clustered random graph laid out in 3D by the GPU forces (link springs +
 * gravity + centering + exact pairwise repulsion at this point count), viewed through the orbit
 * camera. Drag to rotate, scroll to zoom. The layout starts from a compact random cloud and
 * expands as the sim runs.
 */
export const forceSimulation3d = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'

  const config: GraphConfig = {
    spaceSize: 4096,
    backgroundColor: '#0b0e1a',
    pointDefaultSize: 5,
    enableSimulation: true,
    simulationGravity: 0,
    simulationRepulsion: 1.0,
    simulationLinkSpring: 1,
    simulationLinkDistance: 10,
    simulationFriction: 0.85,
    simulationDecay: 100000,
    linkDefaultWidth: 1,
    linkDefaultColor: '#8ea2ff',
    linkOpacity: 0.4,
    curvedLinks: false,
    cameraFov: 55,
    fitViewOnInit: true,
    fitViewDelay: 2000,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  const graph = new Graph(div, config)

  // Build a clustered graph: K communities with dense intra-cluster links and a few bridges.
  const n = 3000
  const clusters = 6
  const spaceSize = 4096
  const center = spaceSize / 2

  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 4)
  const clusterOf = new Array<number>(n)
  const palette = [
    [0.96, 0.44, 0.44], [0.44, 0.7, 0.96], [0.55, 0.86, 0.5],
    [0.9, 0.75, 0.35], [0.75, 0.5, 0.92], [0.4, 0.85, 0.83],
  ]
  for (let i = 0; i < n; i++) {
    const c = i % clusters
    clusterOf[i] = c
    // Start compact near the center so repulsion has room to expand the layout outward.
    positions[i * 3] = center + (Math.random() - 0.5) * 400
    positions[i * 3 + 1] = center + (Math.random() - 0.5) * 400
    positions[i * 3 + 2] = center + (Math.random() - 0.5) * 400
    const col = palette[c] as number[]
    colors[i * 4] = col[0] as number
    colors[i * 4 + 1] = col[1] as number
    colors[i * 4 + 2] = col[2] as number
    colors[i * 4 + 3] = 1
  }

  const links: number[] = []
  for (let i = 0; i < n; i++) {
    // A few intra-cluster links per node.
    for (let k = 0; k < 3; k++) {
      let j = Math.floor(Math.random() * n)
      if (clusterOf[j] !== clusterOf[i]) j = (i + clusters * (k + 1)) % n
      if (j !== i) links.push(i, j)
    }
    // Occasional bridge to another cluster.
    if (i % 25 === 0) links.push(i, Math.floor(Math.random() * n))
  }

  graph.setPointPositions3D(positions)
  graph.setPointColors(colors)
  graph.setLinks(new Float32Array(links))
  graph.render()

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
