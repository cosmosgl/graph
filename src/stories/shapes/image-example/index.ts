import { Graph, PointShape } from '@cosmos.gl/graph'

// Import all PNG icons
import boxUrl from './icons/box.png'
import toolboxUrl from './icons/toolbox.png'
import swiftUrl from './icons/swift.png'
import legoUrl from './icons/lego.png'
import sUrl from './icons/s.png'

// Helper function to convert PNG URL to ImageData
const pngUrlToImageData = (pngUrl: string): Promise<ImageData> => {
  return new Promise<ImageData>((resolve, reject) => {
    const img = new Image()

    img.onload = (): void => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Could not get 2D context'))
        return
      }

      canvas.width = img.width
      canvas.height = img.height
      ctx.drawImage(img, 0, 0)

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      resolve(imageData)
    }
    img.onerror = (): void => reject(new Error(`Failed to load image: ${pngUrl}`))
    img.src = pngUrl
  })
}

const loadPngImages = (pngUrls: string[]): Promise<ImageData[]> => {
  return Promise.all(pngUrls.map(pngUrlToImageData))
}

// Define node types for Xcode dependency graph
enum NodeType {
  App = 0, // Main app target (swift icon)
  Framework = 1, // Framework (box icon)
  Library = 2, // Static library (toolbox icon)
  Bundle = 3, // Bundle (lego icon)
  Target = 4 // Build target (s icon)
}

interface DependencyNode {
  id: number;
  name: string;
  type: NodeType;
  x: number;
  y: number;
  dependencies: number[];
  size: number;
  color: [number, number, number, number];
}

export const imageExample = (): {div: HTMLDivElement; graph: Graph; destroy?: () => void } => {
  // Create container div
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.display = 'flex'
  div.style.flexDirection = 'column'

  // Create main graph container
  const graphContainer = document.createElement('div')
  graphContainer.style.height = '100vh'
  graphContainer.style.width = '100%'
  graphContainer.style.position = 'absolute'
  graphContainer.style.overflow = 'hidden'
  div.appendChild(graphContainer)

  try {
    const spaceSize = 4096

    const nodes: DependencyNode[] = [
      // Main app target (center)
      { id: 0, name: 'MyApp', type: NodeType.App, x: 2048, y: 2048, dependencies: [1, 2, 3, 14], size: 60, color: [0.2, 0.6, 1.0, 1.0] },

      // Frameworks (first ring around center)
      { id: 1, name: 'CoreData', type: NodeType.Framework, x: 1024, y: 2048, dependencies: [4, 5], size: 50, color: [0.8, 0.4, 0.2, 1.0] },
      { id: 2, name: 'UIKit', type: NodeType.Framework, x: 2048, y: 1024, dependencies: [6, 15], size: 50, color: [0.8, 0.4, 0.2, 1.0] },
      { id: 3, name: 'Network', type: NodeType.Framework, x: 3072, y: 2048, dependencies: [7, 8], size: 50, color: [0.8, 0.4, 0.2, 1.0] },

      // Libraries (second ring)
      { id: 4, name: 'SQLite', type: NodeType.Library, x: 512, y: 2048, dependencies: [], size: 45, color: [0.6, 0.8, 0.4, 1.0] },
      { id: 5, name: 'Foundation', type: NodeType.Library, x: 1024, y: 1024, dependencies: [16], size: 45, color: [0.6, 0.8, 0.4, 1.0] },
      { id: 6, name: 'CoreGraphics', type: NodeType.Library, x: 2048, y: 512, dependencies: [], size: 45, color: [0.6, 0.8, 0.4, 1.0] },
      { id: 7, name: 'Security', type: NodeType.Library, x: 3072, y: 1024, dependencies: [], size: 45, color: [0.6, 0.8, 0.4, 1.0] },
      { id: 8, name: 'CFNetwork', type: NodeType.Library, x: 3584, y: 2048, dependencies: [], size: 45, color: [0.6, 0.8, 0.4, 1.0] },

      // Additional frameworks (first ring)
      { id: 9, name: 'Analytics', type: NodeType.Framework, x: 2048, y: 3072, dependencies: [10, 17], size: 50, color: [0.8, 0.4, 0.2, 1.0] },
      { id: 10, name: 'Firebase', type: NodeType.Library, x: 2048, y: 3840, dependencies: [], size: 45, color: [0.6, 0.8, 0.4, 1.0] },

      // Test targets (outer ring)
      { id: 11, name: 'Tests', type: NodeType.Target, x: 512, y: 1024, dependencies: [0], size: 50, color: [0.4, 0.6, 1.0, 1.0] },
      { id: 12, name: 'UITests', type: NodeType.Target, x: 3584, y: 1024, dependencies: [0, 2], size: 45, color: [0.4, 0.6, 1.0, 1.0] },
      { id: 13, name: 'Widget', type: NodeType.Target, x: 3584, y: 3072, dependencies: [1, 2], size: 45, color: [0.4, 0.6, 1.0, 1.0] },

      // Additional components
      { id: 14, name: 'Localization', type: NodeType.Framework, x: 1536, y: 3072, dependencies: [18], size: 50, color: [0.8, 0.4, 0.2, 1.0] },
      { id: 15, name: 'CoreAnimation', type: NodeType.Library, x: 2560, y: 512, dependencies: [], size: 45, color: [0.6, 0.8, 0.4, 1.0] },
      { id: 16, name: 'CoreFoundation', type: NodeType.Library, x: 1024, y: 512, dependencies: [], size: 45, color: [0.6, 0.8, 0.4, 1.0] },
      { id: 17, name: 'Crashlytics', type: NodeType.Library, x: 1536, y: 3584, dependencies: [], size: 45, color: [0.6, 0.8, 0.4, 1.0] },
      { id: 18, name: 'LocalizationBundle', type: NodeType.Bundle, x: 1792, y: 3584, dependencies: [], size: 45, color: [1.0, 0.4, 1.0, 1.0] },

      // More test targets
      { id: 19, name: 'UnitTests', type: NodeType.Target, x: 512, y: 3072, dependencies: [0, 1], size: 45, color: [0.4, 0.6, 1.0, 1.0] },
      { id: 20, name: 'IntegrationTests', type: NodeType.Target, x: 512, y: 3584, dependencies: [0, 3], size: 45, color: [0.4, 0.6, 1.0, 1.0] },

      // Bundle resources
      { id: 21, name: 'Resources', type: NodeType.Bundle, x: 2304, y: 3072, dependencies: [0], size: 50, color: [1.0, 0.4, 1.0, 1.0] },
      { id: 22, name: 'Assets', type: NodeType.Bundle, x: 2560, y: 3584, dependencies: [0, 21], size: 50, color: [1.0, 0.4, 1.0, 1.0] },
    ]

    const pointCount = nodes.length
    const pointPositions = new Float32Array(pointCount * 2)
    const pointColors = new Float32Array(pointCount * 4)
    const pointShapes = new Float32Array(pointCount)
    const pointSizes = new Float32Array(pointCount)
    const imageIndices = new Float32Array(pointCount)

    // Create links array for dependencies
    const links: number[] = []
    const linkArrows: boolean[] = []
    const linkColors: number[] = []

    // Set up nodes based on the dependency structure
    for (const node of nodes) {
      const i = node.id

      // Set positions
      pointPositions[i * 2] = node.x
      pointPositions[i * 2 + 1] = node.y

      // Set node properties - use None shape for all images except targets (s icon)
      pointShapes[i] = node.type === NodeType.Target ? PointShape.Hexagon : PointShape.None
      pointSizes[i] = node.size
      imageIndices[i] = node.type

      // Set colors
      pointColors[i * 4] = node.color[0]
      pointColors[i * 4 + 1] = node.color[1]
      pointColors[i * 4 + 2] = node.color[2]
      pointColors[i * 4 + 3] = node.color[3]

      // Add dependency links
      for (const depId of node.dependencies) {
        links.push(i, depId)
        linkArrows.push(true)

        // Add colorful link colors based on source node type
        const sourceType = node.type
        let linkColor: [number, number, number, number]

        switch (sourceType) {
        case NodeType.App:
          linkColor = [0.2, 0.8, 1.0, 0.8] // Bright blue
          break
        case NodeType.Framework:
          linkColor = [1.0, 0.6, 0.2, 0.8] // Orange
          break
        case NodeType.Library:
          linkColor = [0.4, 1.0, 0.4, 0.8] // Green
          break
        case NodeType.Bundle:
          linkColor = [1.0, 0.4, 1.0, 0.8] // Magenta
          break
        case NodeType.Target:
          linkColor = [0.8, 0.4, 1.0, 0.8] // Purple
          break
        default:
          linkColor = [0.7, 0.7, 0.7, 0.8] // Gray
        }

        // Add RGBA values for this link
        linkColors.push(linkColor[0], linkColor[1], linkColor[2], linkColor[3])
      }
    }

    // Create graph with static positioning
    const graph = new Graph(graphContainer, {
      spaceSize,
      enableSimulation: false,
      enableDrag: false,
      linkDefaultArrows: true,
      curvedLinks: true,
      pointDefaultSize: 50,
      linkDefaultWidth: 3,
      hoveredPointRingColor: 'white',
      renderHoveredPointRing: true,

      // Add click handler for point and background selection
      onPointClick: (pointIndex: number): void => {
        // Use built-in functionality to select the clicked point and its neighbors
        graph.selectPointByIndex(pointIndex, true)
      },
      onBackgroundClick: (): void => {
        // Clear selection when clicking on background
        graph.unselectPoints()
      },
    })

    // Load images asynchronously and set them when ready
    loadPngImages([swiftUrl, boxUrl, toolboxUrl, legoUrl, sUrl]).then((imageDataArray) => {
      // Set images and their indices
      graph.setImageData(imageDataArray)
      graph.setPointImageIndices(imageIndices)
      graph.render()
    }).catch((error) => {
      console.error('Error loading images:', error)
    })

    // Set all data
    graph.setPointPositions(pointPositions)
    graph.setPointColors(pointColors)
    graph.setPointShapes(pointShapes)
    graph.setPointSizes(pointSizes)

    // Set links if we have any dependencies
    if (links.length > 0) {
      graph.setLinks(new Float32Array(links))
      graph.setLinkArrows(linkArrows)
      graph.setLinkColors(new Float32Array(linkColors))
    }

    graph.render()

    const destroy = (): void => {
      graph.destroy()
    }

    return { div, graph, destroy }
  } catch (error) {
    console.error('Error creating Xcode dependency graph:', error)
    div.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #ff0000; font-size: 18px;">
        Error loading Xcode dependency graph: ${error instanceof Error ? error.message : 'Unknown error'}
      </div>
    `
    throw error
  }
}
