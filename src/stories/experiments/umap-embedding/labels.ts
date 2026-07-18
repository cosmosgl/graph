import { Graph } from '@cosmos.gl/graph'

/**
 * HTML label overlay for the embedding stories: every frame, the points sampled
 * by the engine (an evenly distributed subset of what is on screen, controlled
 * by `pointSamplingDistance`) get a country-name label projected to screen
 * coordinates. Works in both 2D and 3D mode.
 */

// Text outline instead of a background: an 8-direction text-shadow works in every
// browser (unlike -webkit-text-stroke) and keeps the glyph fill fully opaque.
const LABEL_CSS = `
  position: absolute;
  top: 0;
  left: 0;
  color: #fff;
  font: 600 11px/1.2 system-ui, -apple-system, sans-serif;
  white-space: nowrap;
  pointer-events: none;
  text-shadow:
    -1px -1px 0 #0b0e1a, 1px -1px 0 #0b0e1a, -1px 1px 0 #0b0e1a, 1px 1px 0 #0b0e1a,
    -1.5px 0 0 #0b0e1a, 1.5px 0 0 #0b0e1a, 0 -1.5px 0 #0b0e1a, 0 1.5px 0 #0b0e1a;
`

/**
 * Attaches the overlay to `container` (which must be `position: relative/absolute`)
 * and starts a per-frame update loop. Returns a cleanup function.
 */
export const attachPointLabels = (graph: Graph, container: HTMLDivElement, names: string[], is3D: boolean): (() => void) => {
  const labelsDiv = document.createElement('div')
  labelsDiv.style.cssText = 'position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 1;'
  container.appendChild(labelsDiv)

  // Pool of label elements keyed by point index, refreshed from the sampled points.
  const labelElements = new Map<number, HTMLDivElement>()
  const updateLabels = (): void => {
    const stale = new Set(labelElements.keys())

    const place = (pointIndex: number, x: number, y: number): void => {
      if (Number.isNaN(x) || Number.isNaN(y)) return // behind the 3D camera
      let element = labelElements.get(pointIndex)
      if (!element) {
        element = document.createElement('div')
        element.style.cssText = LABEL_CSS
        element.textContent = names[pointIndex] ?? `Point ${pointIndex}`
        labelsDiv.appendChild(element)
        labelElements.set(pointIndex, element)
      }
      element.style.transform = `translate(-50%, -130%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      stale.delete(pointIndex)
    }

    if (is3D) {
      for (const [pointIndex, position] of graph.getSampledPointPositionsMap3D()) {
        const [x, y] = graph.spaceToScreenPosition3D(position)
        place(pointIndex, x, y)
      }
    } else {
      for (const [pointIndex, position] of graph.getSampledPointPositionsMap()) {
        const [x, y] = graph.spaceToScreenPosition(position)
        place(pointIndex, x, y)
      }
    }

    // Remove the labels of points that left the sample
    for (const pointIndex of stale) {
      labelElements.get(pointIndex)?.remove()
      labelElements.delete(pointIndex)
    }
  }

  // The view moves outside the simulation loop (zoom, orbit camera), so update
  // the labels every frame instead of only on simulation ticks.
  let rafId = 0
  const tick = (): void => {
    updateLabels()
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)

  return (): void => {
    cancelAnimationFrame(rafId)
    labelsDiv.remove()
  }
}
