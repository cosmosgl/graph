import { Graph } from '@cosmos.gl/graph'
import { createCosmos } from '../create-cosmos'

export const collision = (): { graph: Graph; div: HTMLDivElement } => {
  // Generate random points with varying sizes
  // Using spatial hashing optimization - can handle more points efficiently
  const numPoints = 500
  const pointPositions = new Float32Array(numPoints * 2)
  const pointSizes = new Float32Array(numPoints)
  const pointColors = new Float32Array(numPoints * 4)

  // Place points in a concentrated area to show collision spreading
  for (let i = 0; i < numPoints; i++) {
    // Start with Gaussian-like distribution in center
    const angle = Math.random() * Math.PI * 2
    const radius = Math.abs((Math.random() + Math.random() + Math.random()) / 3) * 400
    pointPositions[i * 2] = 4096 + Math.cos(angle) * radius
    pointPositions[i * 2 + 1] = 4096 + Math.sin(angle) * radius

    // Varying sizes (bigger points near center)
    const distFromCenter = radius / 400
    pointSizes[i] = 2 + (1 - distFromCenter) * 25 + Math.random() * 40

    // Colors based on size - gradient from purple to cyan
    const hue = (pointSizes[i] - 8) / 35
    pointColors[i * 4] = 80 + hue * 100 // R
    pointColors[i * 4 + 1] = 100 + hue * 155 // G
    pointColors[i * 4 + 2] = 220 - hue * 40 // B
    pointColors[i * 4 + 3] = 255 // A
  }

  return createCosmos({
    pointPositions,
    pointSizes,
    pointColors,
    simulationCollision: 0.6, // Increased for 4-pass algorithm
    simulationCollisionRadius: 0, // Use point sizes for collision radius
    simulationRepulsion: 0.1,
    simulationGravity: 0.05,
    simulationDecay: 100000,
    simulationFriction: 0.5,
    fitViewOnInit: true,
    fitViewDelay: 100,
  })
}



