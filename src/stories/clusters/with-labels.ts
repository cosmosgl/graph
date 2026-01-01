import { Graph } from '@cosmos.gl/graph'
import { createClusterLabels } from '../create-cluster-labels'
import { createCosmos } from '../create-cosmos'
import { generateMeshData } from '../generate-mesh-data'

export const withLabels = async (): Promise<{div: HTMLDivElement; graph: Graph; destroy: () => void }> => {
  let nClusters = 2
  const { pointPositions, pointColors, pointClusters } = generateMeshData(100, 100, nClusters, 1.0)

  const { div, graph, destroy: baseDestroy } = await createCosmos({
    pointPositions,
    pointColors,
    pointClusters,
    simulationGravity: 2,
    simulationCluster: 0.25,
    simulationRepulsion: 10,
    pointDefaultSize: 10,
  })

  const updateClusterLabels = createClusterLabels({ div })
  graph.setZoomLevel(0.3)

  graph.setConfig({
    onZoom: updateClusterLabels.bind(this, graph),
    onSimulationTick: updateClusterLabels.bind(this, graph),
  })

  let increasing = true
  const interval = setInterval(() => {
    if (increasing) {
      nClusters += 5
      if (nClusters >= 15) {
        increasing = false
      }
    } else {
      nClusters -= 5
      if (nClusters <= 2) {
        increasing = true
      }
    }

    const nextData = generateMeshData(100, 100, nClusters, 1.0)
    graph.setPointClusters(nextData.pointClusters)
    graph.setPointColors(nextData.pointColors)
    graph.render(1)
  }, 1500)

  const destroy = (): void => {
    clearInterval(interval)
    baseDestroy?.()
  }

  return { div, graph, destroy }
}
