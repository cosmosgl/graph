import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { generateCollisionPoints3D } from './data-gen'

export const collision3D = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const config: GraphConfig = {
    backgroundColor: '#2d313a',
    scalePointsOnZoom: true,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#fff',
    enableDrag: true, // drag a sphere through the pack and watch it displace the others
    fitViewOnInit: true,
    fitViewDelay: 900, // let gravity pull the cloud together before framing it
    transitionDuration: 0,
    // No repulsion and no links: gravity pulls the points into one pile and the
    // collision force (radius = point size / 2) keeps the spheres from overlapping,
    // so they settle into a packed ball.
    enableSimulation: true,
    simulationGravity: 0.5,
    simulationRepulsion: 0,
    simulationCollision: 1,
    simulationFriction: 0.85,
    simulationDecay: 3000,
  }

  const graph = new Graph(div, config)

  const data = generateCollisionPoints3D(600)
  graph.setPointPositions3D(data.pointPositions)
  graph.setPointColors(data.pointColors)
  graph.setPointSizes(data.pointSizes)
  graph.render()

  const buttonsDiv = document.createElement('div')
  buttonsDiv.style.cssText = 'position: absolute; top: 12px; left: 12px; z-index: 2; display: flex; gap: 8px;'
  const buttonStyle = 'padding: 6px 12px; background: #444a57; color: white; border: none; border-radius: 4px; cursor: pointer;'

  const restartButton = document.createElement('button')
  restartButton.textContent = 'Restart'
  restartButton.style.cssText = buttonStyle
  restartButton.addEventListener('click', () => {
    const newData = generateCollisionPoints3D(600)
    graph.setPointPositions3D(newData.pointPositions)
    graph.setPointColors(newData.pointColors)
    graph.setPointSizes(newData.pointSizes)
    graph.render()
    graph.start()
  })
  buttonsDiv.appendChild(restartButton)

  // Toggle the collision force at runtime to see the spheres collapse into each
  // other (off) and push back out into a packing (on)
  let collisionEnabled = true
  const toggleButton = document.createElement('button')
  toggleButton.textContent = 'Collision: on'
  toggleButton.style.cssText = buttonStyle
  toggleButton.addEventListener('click', () => {
    collisionEnabled = !collisionEnabled
    toggleButton.textContent = `Collision: ${collisionEnabled ? 'on' : 'off'}`
    graph.setConfig({ simulationCollision: collisionEnabled ? 1 : 0 })
    // Full alpha: un-packing a collapsed pile needs more energy than settling does
    graph.start(collisionEnabled ? 1 : 0.3)
  })
  buttonsDiv.appendChild(toggleButton)

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
