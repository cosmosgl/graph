import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { generateClusteredGraph3D } from '../force-layout/data-gen'

// Text outline instead of a background: an 8-direction text-shadow works in every
// browser (unlike -webkit-text-stroke) and keeps the glyph fill fully opaque.
const LABEL_CSS = `
  position: absolute;
  top: 0;
  left: 0;
  color: #fff;
  font: 600 12px/1.2 system-ui, -apple-system, sans-serif;
  white-space: nowrap;
  pointer-events: none;
  text-shadow:
    -1px -1px 0 #14161b, 1px -1px 0 #14161b, -1px 1px 0 #14161b, 1px 1px 0 #14161b,
    -1.5px 0 0 #14161b, 1.5px 0 0 #14161b, 0 -1.5px 0 #14161b, 0 1.5px 0 #14161b;
`

export const samplingLabels3D = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const graphDiv = document.createElement('div')
  graphDiv.style.cssText = 'position: absolute; inset: 0;'
  div.appendChild(graphDiv)

  // Overlay for the labels (on top of the canvas, transparent to the mouse)
  const labelsDiv = document.createElement('div')
  labelsDiv.style.cssText = 'position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1;'
  div.appendChild(labelsDiv)

  const config: GraphConfig = {
    backgroundColor: '#2d313a',
    pointDefaultSize: 8,
    scalePointsOnZoom: true,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#fff',
    enableDrag: true,
    fitViewOnInit: true,
    fitViewDelay: 700,
    transitionDuration: 0,
    // Controls how dense the label sampling grid is (in screen pixels):
    // one point per ~110px cell gets a label
    pointSamplingDistance: 110,
    enableSimulation: true,
    simulationGravity: 0.3,
    simulationRepulsion: 1,
    simulationLinkSpring: 1,
    simulationLinkDistance: 12,
    simulationFriction: 0.85,
    simulationDecay: 3000,
  }

  const graph = new Graph(graphDiv, config)

  const data = generateClusteredGraph3D(3000, 6)
  graph.setPointPositions3D(data.pointPositions)
  graph.setPointColors(data.pointColors)
  graph.setLinks(data.links)
  graph.render()

  // Pool of label elements keyed by point index, refreshed every frame from the
  // sampled points (an evenly distributed subset of the points on screen).
  const labelElements = new Map<number, HTMLDivElement>()
  const updateLabels = (): void => {
    const { indices, positions } = graph.getSampledPoints3D()
    const stale = new Set(labelElements.keys())

    for (const [i, pointIndex] of indices.entries()) {
      // Project the sampled 3D position to screen coordinates
      const [x, y] = graph.spaceToScreenPosition3D([
        positions[i * 3 + 0] ?? 0,
        positions[i * 3 + 1] ?? 0,
        positions[i * 3 + 2] ?? 0,
      ])
      if (Number.isNaN(x) || Number.isNaN(y)) continue // behind the camera

      let element = labelElements.get(pointIndex)
      if (!element) {
        element = document.createElement('div')
        element.style.cssText = LABEL_CSS
        element.textContent = `Point ${pointIndex}`
        labelsDiv.appendChild(element)
        labelElements.set(pointIndex, element)
      }
      element.style.transform = `translate(-50%, -130%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      stale.delete(pointIndex)
    }

    // Remove the labels of points that left the sample
    for (const pointIndex of stale) {
      labelElements.get(pointIndex)?.remove()
      labelElements.delete(pointIndex)
    }
  }

  // The camera orbits outside the simulation loop, so update the labels every
  // frame instead of only on simulation ticks
  let rafId = 0
  const tick = (): void => {
    updateLabels()
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)

  const destroy = (): void => {
    cancelAnimationFrame(rafId)
    graph.destroy()
  }

  return { div, graph, destroy }
}
