import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { generateCubeLattice3D } from './data-gen'

export const lattice3D = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const config: GraphConfig = {
    backgroundColor: '#2d313a',
    pointDefaultSize: 24,
    scalePointsOnZoom: true,
    linkDefaultWidth: 1.5,
    linkOpacity: 0.6,
    fitViewOnInit: true,
    fitViewDelay: 1500, // let the lattice untangle before framing it
    transitionDuration: 0,
    enableSimulation: true,
    simulationGravity: 0.4,
    simulationRepulsion: 1.2,
    simulationLinkSpring: 2,
    simulationLinkDistance: 20,
    simulationFriction: 0.85,
    simulationDecay: 5000,
  }

  const graph = new Graph(div, config)

  const data = generateCubeLattice3D(10)
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
    const newData = generateCubeLattice3D(10)
    graph.setPointPositions3D(newData.pointPositions)
    graph.render()
    graph.start()
  })
  buttonsDiv.appendChild(restartButton)

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
