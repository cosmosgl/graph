import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { generateGalaxy3D } from './data-gen'

export const performance3D = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const config: GraphConfig = {
    backgroundColor: '#12141a',
    pointDefaultSize: 4,
    scalePointsOnZoom: true,
    linkDefaultWidth: 1,
    linkOpacity: 0.15,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#fff',
    fitViewOnInit: true,
    showFPSMonitor: true, // rendering-performance stress test — watch the frame rate
    // 3D many-body repulsion is an exact O(n²) pass, far too heavy for 100k points —
    // this story stress-tests rendering, orbiting, and picking only.
    enableSimulation: false,
    onPointClick: (pointIndex, pointPosition) => { console.log('Clicked point index: ', pointIndex, ' at position: ', pointPosition) },
  }

  const graph = new Graph(div, config)

  const data = generateGalaxy3D(100000)
  graph.setPointPositions3D(data.pointPositions)
  graph.setPointColors(data.pointColors)
  graph.setLinks(data.links)
  graph.render()

  const buttonsDiv = document.createElement('div')
  buttonsDiv.style.cssText = 'position: absolute; top: 12px; left: 12px; z-index: 2; display: flex; gap: 8px;'
  const buttonStyle = 'padding: 6px 12px; background: #444a57; color: white; border: none; border-radius: 4px; cursor: pointer;'

  const fitViewButton = document.createElement('button')
  fitViewButton.textContent = 'Fit view'
  fitViewButton.style.cssText = buttonStyle
  fitViewButton.addEventListener('click', () => { graph.fitView() })
  buttonsDiv.appendChild(fitViewButton)

  div.appendChild(buttonsDiv)

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
