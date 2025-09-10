import { Graph, GraphConfigInterface } from '@cosmos.gl/graph'
import { generateData } from './data-generator'
import './style.css'

export const linkHovering = (): { div: HTMLDivElement; graph: Graph } => {
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
    linkArrows: false,
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

  // Create graph instance
  const graph = new Graph(div, config)

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

  return { div, graph }
}
