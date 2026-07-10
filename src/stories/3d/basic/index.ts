import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { generateClusters3D, generateSphereLayout3D } from './data-gen'

export const basic3D = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const config: GraphConfig = {
    // 3D rendering mode: drag orbits the camera, wheel/pinch dollies, Shift/Space + drag pans.
    spaceDimensions: 3,
    backgroundColor: '#2d313a',
    pointDefaultSize: 8,
    scalePointsOnZoom: true,
    linkDefaultWidth: 1,
    linkOpacity: 0.3,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#fff',
    fitViewOnInit: true,
    // This story renders the provided positions as-is; the force simulation
    // (which also works in 3D) would re-layout them.
    enableSimulation: false,
    onPointClick: (pointIndex, pointPosition) => { console.log('Clicked point index: ', pointIndex, ' at position: ', pointPosition) },
    onLinkClick: linkIndex => { console.log('Clicked link index: ', linkIndex) },
    onBackgroundClick: () => { console.log('Clicked background') },
  }

  const graph = new Graph(div, config)

  const data = generateClusters3D(10000, 5)
  graph.setPointPositions(data.pointPositions, { dimensions: 3 })
  graph.setPointColors(data.pointColors)
  graph.setLinks(data.links)
  graph.render()

  // Demo controls: animated 3D re-layout and switching back to 2D mode.
  const buttonsDiv = document.createElement('div')
  buttonsDiv.style.cssText = 'position: absolute; top: 12px; left: 12px; z-index: 2; display: flex; gap: 8px;'
  const buttonStyle = 'padding: 6px 12px; background: #444a57; color: white; border: none; border-radius: 4px; cursor: pointer;'

  let isSphereLayout = false
  const layoutButton = document.createElement('button')
  layoutButton.textContent = 'Switch layout'
  layoutButton.style.cssText = buttonStyle
  layoutButton.addEventListener('click', () => {
    isSphereLayout = !isSphereLayout
    const pointsNumber = data.pointPositions.length / 3
    graph.setPointPositions(isSphereLayout ? generateSphereLayout3D(pointsNumber) : data.pointPositions, { dimensions: 3 })
    graph.render()
  })
  buttonsDiv.appendChild(layoutButton)

  // The rendering mode is decoupled from the data: switching `spaceDimensions`
  // re-projects the same positions without re-ingesting them (in 2D the view is
  // a top-down projection and z is preserved), and the on-screen framing is
  // handed across the projection switch.
  let is2D = false
  const modeButton = document.createElement('button')
  modeButton.textContent = 'Switch to 2D'
  modeButton.style.cssText = buttonStyle
  modeButton.addEventListener('click', () => {
    is2D = !is2D
    modeButton.textContent = is2D ? 'Switch to 3D' : 'Switch to 2D'
    graph.setConfigPartial({ spaceDimensions: is2D ? 2 : 3 })
  })
  buttonsDiv.appendChild(modeButton)

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
