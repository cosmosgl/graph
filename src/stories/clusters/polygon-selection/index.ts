import { Graph } from '@cosmos.gl/graph'
import { createCosmos } from '../../create-cosmos'
import { generateMeshData } from '../../generate-mesh-data'
import { PolygonSelection } from './polygon'

export const polygonSelection = (): {div: HTMLDivElement; graph: Graph; destroy: () => void } => {
  const nClusters = 25
  const { pointPositions, pointColors, pointClusters } = generateMeshData(150, 150, nClusters, 1.0)

  const { div, graph, destroy: baseDestroy } = createCosmos({
    pointPositions,
    pointColors,
    pointClusters,
    simulationGravity: 1.5,
    simulationCluster: 0.3,
    simulationRepulsion: 8,
    pointDefaultSize: 8,
    backgroundColor: '#1a1a2e',
    pointGreyoutOpacity: 0.2,
    onBackgroundClick: (): void => {
      graph.unselectPoints()
    },
  })

  graph.setZoomLevel(0.4)

  const polygonSelection = new PolygonSelection(div, (polygonPoints) => {
    graph.selectPointsInPolygon(polygonPoints)
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
    polygonSelection.destroy()
    if (actionsDiv.parentNode) {
      actionsDiv.parentNode.removeChild(actionsDiv)
    }
    baseDestroy?.()
  }

  return { div, graph, destroy }
}
