import { Graph, GraphConfigInterface } from '@cosmos.gl/graph'
import { luma } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

export const testLumaMigration = async (): Promise<{ graph: Graph; div: HTMLDivElement; destroy?: () => void }> => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'

  // Create the device with a canvas context
  // The device will create its own canvas, which we'll use
  const device = await luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: {
      container: div, // This will create a canvas and add it to the div
      useDevicePixels: true,
      autoResize: true,
    },
  })

  const config: GraphConfigInterface = {
    spaceSize: 4096,
    backgroundColor: '#f25a8a', // '#2d313a',
    pointColor: '#f069b4',
    pointSize: 40,
    scalePointsOnZoom: true,
    simulationGravity: 0,
    // simulationCenter: 1,
    simulationRepulsion: 10,
    // simulationCluster: 0.05, // Cluster force strength
    curvedLinks: false,
    fitViewDelay: 1000,
    fitViewPadding: 0.3,
    rescalePositions: true,
    enableDrag: true,
    renderHoveredPointRing: true,
    hoveredPointCursor: 'pointer',
    hoveredPointRingColor: 'orange',
    focusedPointIndex: 0,
    focusedPointRingColor: 'blue',
    enableSimulation: true,
    linkArrows: true,
    linkArrowsSizeScale: 2,
    linkColor: 'orange',
    linkWidth: 2,
    linkOpacity: 1,
    linkGreyoutOpacity: 0.1,
    hoveredLinkColor: 'red',
    scaleLinksOnZoom: true,
    // renderLinks: false,
    onLinkMouseOver: linkIndex => {
      console.log('Hovered link index: ', linkIndex)
    },
    // Test point interactions
    onPointClick: pointIndex => {
      console.log('Clicked point index: ', pointIndex)
    },
    onPointMouseOver: pointIndex => {
      console.log('Hovered point index: ', pointIndex)
    },
    onBackgroundClick: () => {
      // console.log('Clicked background')
      // // const points = graph.getPointsInRect([[0, 0], [100, 100]])
      // // console.log('Points: ', points)
      // const polygonPath = [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][]
      // const points = graph?.getPointsInPolygon(polygonPath)
      // console.log('Points: ', points)
    },
    onZoomEnd: () => {
      // const sampledPointIndices = graph?.getSampledPoints().indices
      // console.log('Sampled point indices: ', sampledPointIndices)
      // if (sampledPointIndices) {
      //   graph?.selectPointsByIndices(sampledPointIndices)
      // }
    },
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  // Create graph with device
  const graph = new Graph(div, device, config)

  // Create a grid of points to test rendering with different colors and sizes
  const pointCount = 100
  const gridSize = Math.ceil(Math.sqrt(pointCount))
  const pointPositions = new Float32Array(pointCount * 2)
  const pointColors = new Float32Array(pointCount * 4) // RGBA for each point
  const pointSizes = new Float32Array(pointCount) // Size for each point
  const pointShapes = new Float32Array(pointCount) // Shape for each point

  // Define a palette of colors (RGBA values normalized to 0-1)
  const colorPalette = [
    [1.0, 0.0, 0.0, 0.5], // Red
    [0.0, 1.0, 0.0, 0.5], // Green
    [0.0, 0.0, 1.0, 0.5], // Blue
    [1.0, 1.0, 0.0, 0.5], // Yellow
    [1.0, 0.0, 1.0, 0.5], // Magenta
    [0.0, 1.0, 1.0, 0.5], // Cyan
    [1.0, 0.5, 0.0, 0.5], // Orange
    [0.5, 0.0, 1.0, 0.5], // Purple
    [0.94, 0.41, 0.71, 0.5], // Pink (#f069b4)
    [0.95, 0.35, 0.54, 0.5], // Rose (#f25a8a)
  ]

  // Size range: 10 to 60
  const minSize = 10
  const maxSize = 60

  for (let i = 0; i < pointCount; i++) {
    // Position in grid
    const x = (i % gridSize) * 100 - (gridSize * 50)
    const y = Math.floor(i / gridSize) * 100 - (gridSize * 50)
    pointPositions[i * 2] = x
    pointPositions[i * 2 + 1] = y

    // Assign color from palette (cycling through colors)
    const colorIndex = i % colorPalette.length
    const color = colorPalette[colorIndex]!
    pointColors[i * 4] = color[0]! // R
    pointColors[i * 4 + 1] = color[1]! // G
    pointColors[i * 4 + 2] = color[2]! // B
    pointColors[i * 4 + 3] = color[3]! // A

    // Assign size (varying sizes, could be based on position, index, or random)
    // Using a pattern: larger points in center, smaller at edges
    const centerX = (gridSize - 1) / 2
    const centerY = (gridSize - 1) / 2
    const pointX = i % gridSize
    const pointY = Math.floor(i / gridSize)
    const distFromCenter = Math.sqrt(
      Math.pow(pointX - centerX, 2) + Math.pow(pointY - centerY, 2)
    )
    const maxDist = Math.sqrt(Math.pow(centerX, 2) + Math.pow(centerY, 2))
    // Size decreases from center to edge, with some variation
    const normalizedDist = distFromCenter / maxDist
    const baseSize = minSize + (maxSize - minSize) * (1 - normalizedDist)
    // Add some variation based on index for more visual interest
    const variation = (i % 3) * 5 // Add 0, 5, or 10 pixels variation
    pointSizes[i] = Math.max(minSize, Math.min(maxSize, baseSize + variation))

    // Assign shape (cycling through available shapes: Circle, Square, Triangle, Diamond, Pentagon, Hexagon, Star, Cross)
    // Shape values: 0 = Circle, 1 = Square, 2 = Triangle, 3 = Diamond, 4 = Pentagon, 5 = Hexagon, 6 = Star, 7 = Cross, 8 = None
    const shapeIndex = i % 8 // Cycle through shapes 0-7 (excluding None)
    pointShapes[i] = shapeIndex
  }

  graph.setPointPositions(pointPositions)
  graph.setPointColors(pointColors)
  graph.setPointSizes(pointSizes)
  graph.setPointShapes(pointShapes)

  // Create cluster assignments - group points into clusters based on their shape
  // Points with the same shape will be in the same cluster
  const pointClusters: (number | undefined)[] = []
  const numShapes = 8 // Number of different shapes (0-7)
  for (let i = 0; i < pointCount; i++) {
    const shapeIndex = i % numShapes
    // Assign each shape group to a cluster (cluster index = shape index)
    pointClusters.push(shapeIndex)
  }
  // graph.setPointClusters(pointClusters)

  // Optionally set explicit cluster positions (centered around the grid)
  // If not set, clusters will use centermass (average position of points in cluster)
  const clusterPositions: (number | undefined)[] = []
  for (let clusterIndex = 0; clusterIndex < numShapes; clusterIndex++) {
    // Position clusters in a circle around the center
    const angle = (clusterIndex / numShapes) * Math.PI * 2
    const radius = gridSize * 30 // Distance from center
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    clusterPositions.push(x, y)
  }
  // graph.setClusterPositions(clusterPositions)

  // Create links to test link rendering
  const links = new Float32Array((pointCount - 1) * 2)
  for (let i = 0; i < pointCount - 1; i++) {
    links[i * 2] = i
    links[i * 2 + 1] = i + 1
  }

  graph.setLinks(links)

  graph.render()
  graph.trackPointPositionsByIndices([0, 1])

  // Dynamic update: change links 5s after initial rendering
  // setTimeout(() => {
  //   if (!graph) return
  //   // Create a simple star topology: node 0 connected to all others
  //   const dynamicLinks = new Float32Array((pointCount - 1) * 2)
  //   for (let i = 1; i < pointCount; i++) {
  //     dynamicLinks[(i - 1) * 2] = 0
  //     dynamicLinks[(i - 1) * 2 + 1] = i
  //   }
  //   graph.setLinks(dynamicLinks)
  //   graph.setConfig({ renderLinks: true })
  //   graph.render()
  // }, 5000)

  const destroy = (): void => {
    graph.destroy()
    device.destroy()
  }

  return { div, graph, destroy }
}
