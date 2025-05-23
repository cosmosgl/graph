import { Graph } from '@cosmos.gl/graph'
import { createCosmos } from '../create-cosmos'
import { generateMeshData } from '../generate-mesh-data'

export const fullMesh = (): { graph: Graph; div: HTMLDivElement} => {
  const { pointPositions, links, pointColors } = generateMeshData(40, 30, 15, 1.0)

  return createCosmos({
    pointPositions,
    links,
    pointColors,
  })
}
