import { Graph, type GraphConfig } from '@cosmos.gl/graph'

/** HSL (0..1) to RGB (0..1), for evenly-spaced community colors. */
function hslToRgb (h: number, s: number, l: number): [number, number, number] {
  const k = (n: number): number => (n + h * 12) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

/**
 * 3D force-simulation stress test: 100k points in a clustered scale-free graph (communities with
 * hub structure from preferential attachment, plus sparse bridges), simulated and rendered in 3D.
 * The community structure gives the force layout something organic to shape, and the FPS monitor
 * gauges performance of the octree repulsion + rendering at scale.
 */
export const stressTest3d = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'

  const config: GraphConfig = {
    spaceDimensions: 3,
    spaceSize: 4096,
    backgroundColor: '#0a0a14',
    pointDefaultSize: 2,
    pointDefaultColor: '#77aaff',
    enableSimulation: true,
    simulationGravity: 0.25,
    simulationRepulsion: 1.0,
    simulationLinkSpring: 1,
    simulationLinkDistance: 10,
    simulationFriction: 0.85,
    simulationDecay: 100000,
    linkDefaultWidth: 0.5,
    linkDefaultColor: '#3a4a7a',
    linkOpacity: 0.25,
    curvedLinks: false,
    cameraFov: 60,
    fitViewOnInit: true,
    fitViewDelay: 3000,
    showFPSMonitor: true,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  const graph = new Graph(div, config)

  const n = 100000
  const clusters = 100
  const clusterSize = Math.ceil(n / clusters)
  const spaceSize = 4096
  const center = spaceSize / 2

  // One color per community.
  const clusterColors = Array.from({ length: clusters }, (_, c) => hslToRgb(c / clusters, 0.55, 0.62))

  // Give each community its own initial center spread through a large sphere, then scatter its nodes
  // in a smaller local sphere around it. Communities start visibly separated (organic clustered look
  // from the first frame) and the simulation refines from there.
  const randomInSphere = (radius: number): [number, number, number] => {
    const r = radius * Math.cbrt(Math.random())
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    return [r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi)]
  }
  const clusterCenters = Array.from({ length: clusters }, () => randomInSphere(spaceSize * 0.3))

  const positions = new Float32Array(n * 3)
  const colors = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const c = Math.min(clusters - 1, Math.floor(i / clusterSize))
    const cc = clusterCenters[c] as [number, number, number]
    const off = randomInSphere(spaceSize * 0.07)
    positions[i * 3] = center + cc[0] + off[0]
    positions[i * 3 + 1] = center + cc[1] + off[1]
    positions[i * 3 + 2] = center + cc[2] + off[2]
    const col = clusterColors[c] as [number, number, number]
    colors[i * 4] = col[0]
    colors[i * 4 + 1] = col[1]
    colors[i * 4 + 2] = col[2]
    colors[i * 4 + 3] = 1
  }

  // Clustered scale-free links: within each community, connect to earlier nodes by preferential
  // attachment (creates hubs); occasionally bridge to another community. This gives the force layout
  // real structure (dense communities + hubs) instead of a featureless random blob.
  const links: number[] = []
  const poolByCluster: number[][] = Array.from({ length: clusters }, () => [])
  const edgesPerNode = 2
  for (let i = 0; i < n; i++) {
    const c = Math.min(clusters - 1, Math.floor(i / clusterSize))
    const clusterStart = c * clusterSize
    const pool = poolByCluster[c] as number[]
    for (let k = 0; k < edgesPerNode; k++) {
      let t = -1
      if (pool.length > 0 && Math.random() < 0.85) {
        t = pool[Math.floor(Math.random() * pool.length)] as number // preferential attachment → hubs
      } else if (i > clusterStart) {
        t = clusterStart + Math.floor(Math.random() * (i - clusterStart))
      }
      if (t >= 0 && t !== i) {
        links.push(i, t)
        pool.push(i, t) // both endpoints gain "degree" in the attachment pool
      }
    }
    if (i > 0 && Math.random() < 0.02) links.push(i, Math.floor(Math.random() * i)) // sparse bridge
  }

  graph.setPointPositions(positions, { dimensions: 3 })
  graph.setPointColors(colors)
  graph.setLinks(new Float32Array(links))
  graph.render()

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
