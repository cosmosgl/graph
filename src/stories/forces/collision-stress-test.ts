import { Graph, getRgbaColor } from '@cosmos.gl/graph'
import { scaleSequential } from 'd3-scale'
import { interpolateRainbow } from 'd3-scale-chromatic'
import { createCosmos } from '../create-cosmos'

export const collisionStressTest = (): { graph: Graph; div: HTMLDivElement } => {
  // Stress test for the collision force on a large graph (50K points).
  // Points are seeded with heavy overlap inside a dense disc, so the
  // spatial-hash collision force has to resolve a large number of overlaps
  // every tick — a worst case for its performance. The FPS monitor is enabled
  // so the cost under load is visible.
  const numPoints = 50_000
  const spaceCenter = 2048
  const seedRadius = 1500

  const colorScale = scaleSequential(interpolateRainbow).domain([0, 1])

  const pointPositions = new Float32Array(numPoints * 2)
  const pointSizes = new Float32Array(numPoints)
  const pointColors = new Float32Array(numPoints * 4)

  for (let i = 0; i < numPoints; i++) {
    // Uniform area density within the disc (sqrt keeps it from clumping centre)
    const angle = Math.random() * Math.PI * 2
    const radius = Math.sqrt(Math.random()) * seedRadius
    pointPositions[i * 2] = spaceCenter + Math.cos(angle) * radius
    pointPositions[i * 2 + 1] = spaceCenter + Math.sin(angle) * radius

    // Small points with a little variability so collision radii differ
    pointSizes[i] = 2 + Math.random() * 15

    // Colour by distance from the centre for a clean radial gradient
    const rgba = getRgbaColor(colorScale(radius / seedRadius))
    pointColors[i * 4] = rgba[0]
    pointColors[i * 4 + 1] = rgba[1]
    pointColors[i * 4 + 2] = rgba[2]
    pointColors[i * 4 + 3] = 1
  }

  return createCosmos({
    pointPositions,
    pointSizes,
    pointColors,
    simulationCollision: 0.25,
    simulationCollisionPadding: 1,
    simulationCollisionRadius: undefined, // derive collision radius from point sizes
    // Isolate the collision force: no repulsion, a gentle gravity that keeps the
    // points packed so collision has to keep resolving overlap every tick.
    simulationRepulsion: 0,
    simulationGravity: 0.001,
    simulationDecay: 100000,
    simulationFriction: 0.85,
    showFPSMonitor: true, // read the collision cost under load
    fitViewOnInit: false,
    fitViewDelay: 0,
    fitViewDuration: 0,
  })
}
