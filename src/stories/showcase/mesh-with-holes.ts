import { Graph } from '@cosmos.gl/graph'
import { createCosmos } from '../create-cosmos'
import { generateMeshData } from '../generate-mesh-data'

export const meshWithHoles = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void} => {
  const { pointPositions, links, pointColors } = generateMeshData(40, 80, 15, 0.8)

  return createCosmos({
    pointPositions,
    links,
    pointColors,
  })
}
