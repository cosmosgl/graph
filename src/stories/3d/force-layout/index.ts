import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { generateClusteredGraph3D } from './data-gen'

export const forceLayout3D = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const config: GraphConfig = {
    backgroundColor: '#2d313a',
    pointDefaultSize: 8,
    scalePointsOnZoom: true,
    linkDefaultWidth: 1,
    linkOpacity: 0.4,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#fff',
    enableDrag: true, // drag points in the camera-facing plane of their depth
    fitViewOnInit: true,
    fitViewDelay: 700, // let the layout inflate before framing it
    transitionDuration: 0, // simulation moves points; no need for transitions
    // The force simulation runs in 3D: repulsion is an exact O(n²) pass,
    // so keep the point count in the low tens of thousands.
    enableSimulation: true,
    simulationGravity: 0.3,
    simulationRepulsion: 1,
    simulationLinkSpring: 1,
    simulationLinkDistance: 12,
    simulationFriction: 0.85,
    simulationDecay: 3000,
    onPointClick: (pointIndex, pointPosition) => { console.log('Clicked point index: ', pointIndex, ' at position: ', pointPosition) },
  }

  const graph = new Graph(div, config)

  const data = generateClusteredGraph3D(3000, 6)
  graph.setPointPositions3D(data.pointPositions)
  graph.setPointColors(data.pointColors)
  graph.setLinks(data.links)
  graph.render()

  const buttonsDiv = document.createElement('div')
  buttonsDiv.style.cssText = 'position: absolute; top: 12px; left: 12px; z-index: 2; display: flex; gap: 8px;'
  const buttonStyle = 'padding: 6px 12px; background: #444a57; color: white; border: none; border-radius: 4px; cursor: pointer;'

  const restartButton = document.createElement('button')
  restartButton.textContent = 'Restart'
  restartButton.style.cssText = buttonStyle
  restartButton.addEventListener('click', () => {
    const newData = generateClusteredGraph3D(3000, 6)
    graph.setPointPositions3D(newData.pointPositions)
    graph.setPointColors(newData.pointColors)
    graph.setLinks(newData.links)
    graph.render()
    graph.start()
  })
  buttonsDiv.appendChild(restartButton)

  const pauseButton = document.createElement('button')
  pauseButton.textContent = 'Pause'
  pauseButton.style.cssText = buttonStyle
  pauseButton.addEventListener('click', () => {
    if (graph.isSimulationRunning) {
      graph.pause()
      pauseButton.textContent = 'Resume'
    } else {
      graph.unpause()
      pauseButton.textContent = 'Pause'
    }
  })
  buttonsDiv.appendChild(pauseButton)

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
