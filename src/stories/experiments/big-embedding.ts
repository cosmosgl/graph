import { Graph } from '@cosmos.gl/graph'
import { createCosmos } from '../create-cosmos'
import { generateBigEmbeddingData } from './big-embedding-data-gen'

export const bigEmbedding = async (): Promise<{ graph: Graph; div: HTMLDivElement; destroy?: () => void}> => {
  const { pointPositions, pointColors } = generateBigEmbeddingData(3000000)

  return createCosmos({
    pointPositions,
    pointColors,
    // No links - just points
    links: new Float32Array(0),
    // Disable simulation since we have predefined coordinates
    enableSimulation: false,
    spaceSize: 4096,
    backgroundColor: '#1a1a1a',
    pointDefaultSize: 0.5,
    scalePointsOnZoom: true,
    renderLinks: false,
    fitViewOnInit: true,
    fitViewPadding: 0.1,
    showFPSMonitor: true,
  })
}
