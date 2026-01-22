import { Graph } from '@cosmos.gl/graph'
import { luma } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'
import { generateData } from './data-gen'

export const pinnedPoints = (): { graph: Graph; div: HTMLDivElement; destroy: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const infoPanel = document.createElement('div')
  infoPanel.textContent = 'White points are pinned. Try to move them.'
  Object.assign(infoPanel.style, {
    position: 'absolute',
    top: '20px',
    left: '20px',
    color: 'white',
    fontSize: '14px',
  })
  div.appendChild(infoPanel)

  const devicePromise = luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: {
      useDevicePixels: window.devicePixelRatio || 2,
      autoResize: true,
    },
  })

  const graph = new Graph(div, {
    spaceSize: 4096,
    backgroundColor: '#2d313a',
    curvedLinks: true,
    enableDrag: true,
    simulationLinkSpring: 3.1,
    simulationRepulsion: 150,
    simulationGravity: 0.05,
    simulationDecay: 10000000,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }, devicePromise)

  const { pointPositions, links, pointColors } = generateData(100)

  const pinnedIndices = [0, 1, 2, 3, 4, 5]
  const numPoints = pointPositions.length / 2

  const colors = new Float32Array(pointColors)
  for (const pinnedIndex of pinnedIndices) {
    colors[pinnedIndex * 4] = 1.0
    colors[pinnedIndex * 4 + 1] = 1.0
    colors[pinnedIndex * 4 + 2] = 1.0
    colors[pinnedIndex * 4 + 3] = 1.0
  }

  const pointSizes = new Float32Array(numPoints).fill(12)
  for (const pinnedIndex of pinnedIndices) {
    pointSizes[pinnedIndex] = 30
  }

  graph.setPointPositions(pointPositions)
  graph.setPointColors(colors)
  graph.setPointSizes(pointSizes)
  graph.setLinks(links)
  graph.setPinnedPoints(pinnedIndices)

  graph.zoom(0.8)
  graph.render()

  // Cleanup function to destroy the external device
  const destroy = (): void => {
    graph.destroy()
    devicePromise.then(device => device.destroy())
  }

  return { div, graph, destroy }
}
