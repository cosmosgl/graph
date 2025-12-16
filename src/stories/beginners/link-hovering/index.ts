import { Graph, GraphConfigInterface } from '@cosmos.gl/graph'
import { luma } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'
import { generateData } from './data-generator'
import './style.css'

export const linkHovering = async (): Promise<{ div: HTMLDivElement; graph: Graph; destroy?: () => void }> => {
  const data = generateData()
  const infoPanel = document.createElement('div')

  // Create div container
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  // Configure graph
  const config: GraphConfigInterface = {
    backgroundColor: '#2d313a',
    scalePointsOnZoom: true,
    linkDefaultArrows: false,
    curvedLinks: true,
    enableSimulation: false,
    hoveredLinkWidthIncrease: 4,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',

    onLinkMouseOver: (linkIndex: number) => {
      infoPanel.style.display = 'block'
      infoPanel.textContent = `Link ${linkIndex}`
    },

    onLinkMouseOut: () => {
      infoPanel.style.display = 'none'
    },
  }

  // Create luma device and graph instance
  const device = await luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: {
      container: div,
      useDevicePixels: true,
      autoResize: true,
      width: undefined,
      height: undefined,
    },
  })

  const graph = new Graph(div, device, config)

  // Set data
  graph.setPointPositions(data.pointPositions)
  graph.setPointColors(data.pointColors)
  graph.setPointSizes(data.pointSizes)
  graph.setLinks(data.links)
  graph.setLinkColors(data.linkColors)
  graph.setLinkWidths(data.linkWidths)

  // Render graph
  graph.zoom(0.9)
  graph.render()

  infoPanel.style.cssText = `
    position: absolute;
    top: 20px;
    left: 20px;
    color: white;
    font-size: 14px;
    display: none;
  `
  div.appendChild(infoPanel)

  const destroy = (): void => {
    graph.destroy()
    device.destroy()
  }

  return { div, graph, destroy }
}
