import { Graph } from '@cosmos.gl/graph'
import { createCosmos } from '../../create-cosmos'
import { generateMeshData } from '../../generate-mesh-data'
import { PolygonSelection } from './polygon'

export const polygonSelection = (): {div: HTMLDivElement; graph: Graph; destroy: () => void } => {
  const nClusters = 25
  let selectionRequest = 0
  // wholeness 0: the story renders no links, so skip generating them
  const { pointPositions, pointColors, pointClusters } = generateMeshData(150, 150, nClusters, 0, undefined, 2453)

  const { div, graph } = createCosmos({
    pointPositions,
    pointColors,
    pointClusters,
    // Seed the force independently of the mesh so both previews replay the same motion inputs.
    randomSeed: 'lasso-replay',
    simulationGravity: 1.5,
    simulationCluster: 0.3,
    simulationRepulsion: 8,
    pointDefaultSize: 8,
    backgroundColor: '#1a1a2e',
    pointGreyoutOpacity: 0.2,
    onBackgroundClick: (): void => {
      selectionRequest++
      graph.setConfigPartial({ highlightedPointIndices: undefined })
    },
  })

  graph.setZoomLevel(0.4)

  const polygonSelection = new PolygonSelection(div, (polygonPoints) => {
    const request = ++selectionRequest
    graph.findPointsInPolygonAsync(polygonPoints).then(indices => {
      if (indices && request === selectionRequest) graph.setConfigPartial({ highlightedPointIndices: indices })
    }).catch((error: unknown) => { console.error('Polygon selection failed', error) })
  })

  const actionsDiv = document.createElement('div')
  actionsDiv.className = 'actions'
  div.appendChild(actionsDiv)

  const polygonButton = document.createElement('div')
  polygonButton.className = 'action'
  polygonButton.textContent = 'Enable Polygon Selection'
  polygonButton.addEventListener('click', () => {
    polygonSelection.enablePolygonMode()
  })
  actionsDiv.appendChild(polygonButton)

  const destroy = (): void => {
    selectionRequest++
    polygonSelection.destroy()
    if (actionsDiv.parentNode) {
      actionsDiv.parentNode.removeChild(actionsDiv)
    }
  }

  return { div, graph, destroy }
}
