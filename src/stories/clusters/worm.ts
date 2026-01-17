
import { Graph } from '@cosmos.gl/graph'
import { createCosmos } from '../create-cosmos'
import { generateMeshData } from '../generate-mesh-data'

export const worm = (): {graph: Graph; div: HTMLDivElement; destroy?: () => void} => {
  const { pointPositions, pointColors, links, linkColors, pointClusters } = generateMeshData(100, 100, 1000, 1.0)

  const { div, graph, destroy } = createCosmos({
    simulationGravity: 0.5,
    simulationRepulsion: 1,
    simulationLinkSpring: 1,
    pointPositions,
    pointColors,
    pointClusters,
    links,
    linkColors,
    onSimulationTick: () => {
      const currentPointColors = graph.getPointColors()
      const newPointColors = new Float32Array(currentPointColors.length)
      for (let i = 0; i < currentPointColors.length / 4; i++) {
        if (i === 0) {
          newPointColors[i * 4] = currentPointColors[currentPointColors.length - 4] as number
          newPointColors[i * 4 + 1] = currentPointColors[currentPointColors.length - 3] as number
          newPointColors[i * 4 + 2] = currentPointColors[currentPointColors.length - 2] as number
          newPointColors[i * 4 + 3] = currentPointColors[currentPointColors.length - 1] as number
        } else {
          newPointColors[i * 4] = currentPointColors[(i - 1) * 4] as number
          newPointColors[i * 4 + 1] = currentPointColors[(i - 1) * 4 + 1] as number
          newPointColors[i * 4 + 2] = currentPointColors[(i - 1) * 4 + 2] as number
          newPointColors[i * 4 + 3] = currentPointColors[(i - 1) * 4 + 3] as number
        }
      }
      graph.setPointColors(newPointColors)
      graph.render()
    },
  })

  return { div, graph, destroy }
}
