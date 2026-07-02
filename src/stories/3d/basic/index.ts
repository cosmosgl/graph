import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { generateClusters3D, generateSphereLayout3D } from './data-gen'

export const basic3D = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const config: GraphConfig = {
    backgroundColor: '#2d313a',
    pointDefaultSize: 20,
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
  // Passing [x, y, z, ...] triplets switches the graph into 3D rendering mode:
  // drag orbits the camera, wheel/pinch dollies, Space + drag pans.
  graph.setPointPositions3D(data.pointPositions)
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
    graph.setPointPositions3D(isSphereLayout ? generateSphereLayout3D(pointsNumber) : data.pointPositions)
    graph.render()
  })
  buttonsDiv.appendChild(layoutButton)

  let is2D = false
  const modeButton = document.createElement('button')
  modeButton.textContent = 'Switch to 2D'
  modeButton.style.cssText = buttonStyle
  modeButton.addEventListener('click', () => {
    is2D = !is2D
    modeButton.textContent = is2D ? 'Switch to 3D' : 'Switch to 2D'
    if (is2D) {
      // Drop the z coordinate — the graph animates back into the 2D plane.
      const pointsNumber = data.pointPositions.length / 3
      const positions2D = new Float32Array(pointsNumber * 2)
      for (let i = 0; i < pointsNumber; i += 1) {
        positions2D[i * 2 + 0] = data.pointPositions[i * 3 + 0] as number
        positions2D[i * 2 + 1] = data.pointPositions[i * 3 + 1] as number
      }
      graph.setPointPositions(positions2D, true)
    } else {
      graph.setPointPositions3D(isSphereLayout
        ? generateSphereLayout3D(data.pointPositions.length / 3)
        : data.pointPositions)
    }
    graph.render()
    graph.fitView()
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
