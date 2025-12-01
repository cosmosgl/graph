import { Graph, PointShape } from '@cosmos.gl/graph'

export const allShapes = (): {div: HTMLDivElement; graph: Graph } => {
  // Create container div
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'

  // Create 8 points, one for each shape
  const spaceSize = 4096
  const pointCount = 8
  const spacing = spaceSize / pointCount

  const pointPositions = new Float32Array(pointCount * 2)
  const pointColors = new Float32Array(pointCount * 4)
  const pointShapes = new Float32Array(pointCount)

  // Define distinct colors for each shape
  const shapeColors: [number, number, number][] = [
    [1.0, 0.42, 0.38], // Coral for Circle
    [0.13, 0.55, 0.45], // Forest Green for Square
    [0.25, 0.32, 0.71], // Royal Blue for Triangle
    [0.96, 0.76, 0.19], // Amber Gold for Diamond
    [0.74, 0.24, 0.45], // Deep Rose for Pentagon
    [0.18, 0.55, 0.56], // Teal for Hexagon
    [0.85, 0.45, 0.28], // Terracotta for Star
    [0.58, 0.44, 0.86], // Periwinkle for Cross
  ]

  // Position points in a horizontal line
  const startX = spacing / 2
  const centerY = spaceSize / 2
  for (let i = 0; i < pointCount; i++) {
    // Position: horizontal line, centered
    pointPositions[i * 2] = startX + i * spacing
    pointPositions[i * 2 + 1] = centerY

    // Color: distinct color for each shape
    const color = shapeColors[i] || [1.0, 1.0, 1.0] // fallback to white if undefined
    pointColors[i * 4] = color[0] // R
    pointColors[i * 4 + 1] = color[1] // G
    pointColors[i * 4 + 2] = color[2] // B
    pointColors[i * 4 + 3] = 1.0 // A

    // Shape: cycle through all available shapes
    pointShapes[i] = i as PointShape
  }

  // Create graph with minimal configuration
  const graph = new Graph(div, {
    spaceSize,
    pointDefaultSize: spacing / 2,
    enableSimulation: false,
    scalePointsOnZoom: true,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#ffffff',
    rescalePositions: false,
    enableDrag: true,
  })

  // Set data
  graph.setPointPositions(pointPositions)
  graph.setPointColors(pointColors)
  graph.setPointShapes(pointShapes)

  graph.render()

  return { div, graph }
}
