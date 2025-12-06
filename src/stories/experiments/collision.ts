import { Graph } from '@cosmos.gl/graph'
import { createCosmos } from '../create-cosmos'

export const collision = (): { graph: Graph; div: HTMLDivElement } => {
  // Generate random points with varying sizes
  const numPoints = 200
  const pointPositions = new Float32Array(numPoints * 2)
  const pointSizes = new Float32Array(numPoints)
  const pointColors = new Float32Array(numPoints * 4)

  // Place points in a concentrated area
  for (let i = 0; i < numPoints; i++) {
    pointPositions[i * 2] = 4096 + (Math.random() - 0.5) * 800
    pointPositions[i * 2 + 1] = 4096 + (Math.random() - 0.5) * 800

    // Varying sizes
    pointSizes[i] = 10 + Math.random() * 30

    // Colors based on size
    const hue = (pointSizes[i] - 10) / 30
    pointColors[i * 4] = 100 + hue * 155 // R
    pointColors[i * 4 + 1] = 80 + (1 - hue) * 100 // G
    pointColors[i * 4 + 2] = 200 // B
    pointColors[i * 4 + 3] = 255 // A
  }

  return createCosmos({
    pointPositions,
    pointSizes,
    pointColors,
    simulationCollision: 1.0,
    simulationCollisionRadius: 0, // Use point sizes for collision radius
    simulationRepulsion: 0.2,
    simulationGravity: 0.1,
    simulationDecay: 50000,
    simulationFriction: 0.9,
    fitViewOnInit: true,
    fitViewDelay: 100,
  })
}



