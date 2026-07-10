import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { generateClusteredPoints3D } from './data-gen'

const SPACE_SIZE = 4096

export const clustering3D = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const config: GraphConfig = {
    spaceDimensions: 3,
    spaceSize: SPACE_SIZE,
    backgroundColor: '#2d313a',
    pointDefaultSize: 6,
    scalePointsOnZoom: true,
    enableDrag: true,
    fitViewOnInit: true,
    fitViewDelay: 900, // let the blobs form before framing them
    transitionDuration: 0,
    // No links: the cluster force pulls every point toward its cluster's
    // centermass (or a pinned position) while many-body repulsion inflates the
    // blobs and pushes them apart.
    enableSimulation: true,
    simulationGravity: 0.15,
    simulationRepulsion: 0.5,
    simulationCluster: 0.35,
    simulationFriction: 0.85,
    simulationDecay: 3000,
  }

  const graph = new Graph(div, config)

  const data = generateClusteredPoints3D(4000, 6)
  graph.setPointPositions(data.pointPositions, { dimensions: 3 })
  graph.setPointColors(data.pointColors)
  graph.setPointClusters(data.pointClusters)
  graph.render()

  const buttonsDiv = document.createElement('div')
  buttonsDiv.style.cssText = 'position: absolute; top: 12px; left: 12px; z-index: 2; display: flex; gap: 8px;'
  const buttonStyle = 'padding: 6px 12px; background: #444a57; color: white; border: none; border-radius: 4px; cursor: pointer;'

  const restartButton = document.createElement('button')
  restartButton.textContent = 'Restart'
  restartButton.style.cssText = buttonStyle
  restartButton.addEventListener('click', () => {
    const newData = generateClusteredPoints3D(4000, 6)
    graph.setPointPositions(newData.pointPositions, { dimensions: 3 })
    graph.setPointColors(newData.pointColors)
    graph.setPointClusters(newData.pointClusters)
    graph.render()
    graph.start()
  })
  buttonsDiv.appendChild(restartButton)

  // Toggle between centermass clustering and positions pinned at the vertices
  // of an octahedron via `setClusterPositions3D`
  let pinned = false
  const pinButton = document.createElement('button')
  pinButton.textContent = 'Pin to octahedron'
  pinButton.style.cssText = buttonStyle
  pinButton.addEventListener('click', () => {
    pinned = !pinned
    pinButton.textContent = pinned ? 'Unpin' : 'Pin to octahedron'
    if (pinned) {
      const c = SPACE_SIZE / 2
      const r = SPACE_SIZE * 0.3
      graph.setClusterPositions3D([
        c + r, c, c,
        c - r, c, c,
        c, c + r, c,
        c, c - r, c,
        c, c, c + r,
        c, c, c - r,
      ])
    } else {
      // All coordinates undefined — every cluster falls back to its centermass
      graph.setClusterPositions3D(new Array(data.clustersNumber * 3).fill(undefined))
    }
    graph.render()
    graph.start(0.5)
  })
  buttonsDiv.appendChild(pinButton)

  const fitViewButton = document.createElement('button')
  fitViewButton.textContent = 'Fit view'
  fitViewButton.style.cssText = buttonStyle
  fitViewButton.addEventListener('click', () => { graph.fitView() })
  buttonsDiv.appendChild(fitViewButton)

  div.appendChild(buttonsDiv)

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
