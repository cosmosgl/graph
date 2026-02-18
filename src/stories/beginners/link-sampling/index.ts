import { Graph, GraphConfigInterface } from '@cosmos.gl/graph'
import { generateLinkSamplingDemoData } from './data'
import { LinkSamplingLabels } from './labels'
import './style.css'

export const linkSampling = (): { div: HTMLDivElement; graph: Graph; destroy?: () => void } => {
  const data = generateLinkSamplingDemoData()

  const div = document.createElement('div')
  div.className = 'link-sampling-demo'
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const graphDiv = document.createElement('div')
  graphDiv.style.width = '100%'
  graphDiv.style.height = '100%'
  div.appendChild(graphDiv)

  const labelsContainer = document.createElement('div')
  labelsContainer.className = 'link-sampling-labels'
  div.appendChild(labelsContainer)

  const linkLabels = new LinkSamplingLabels(labelsContainer)

  const config: GraphConfigInterface = {
    backgroundColor: '#252830',
    pointDefaultColor: '#adb5c7',
    scalePointsOnZoom: true,
    linkDefaultArrows: false,
    linkDefaultWidth: 2,
    curvedLinks: true,
    enableSimulation: false,
    linkSamplingDistance: 50,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
    onZoom: () => linkLabels.update(graph),
    onDragEnd: () => linkLabels.update(graph),
  }

  const graph = new Graph(graphDiv, config)

  graph.setPointPositions(data.pointPositions)
  graph.setLinks(data.links)
  graph.setLinkColors(data.linkColors)

  graph.render()

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
