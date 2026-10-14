import { describe, it, expect } from 'vitest'

import { Graph, type GraphConfig } from '@cosmos.gl/graph'

/**
 * `spaceSize` sets the initial framing and bounds no position: graph size, not a
 * config constant, decides how large a layout gets. These tests pin the pieces that
 * make that true at a scale SwiftShader can run; the large-graph behaviour (hundreds
 * of thousands of points) is measured with the Space Size Wall story.
 */

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

const withCanvasGraph = async (
  config: GraphConfig,
  positions: Float32Array,
  run: (graph: Graph, div: HTMLDivElement) => Promise<void>
): Promise<void> => {
  const div = document.createElement('div')
  div.style.width = '400px'
  div.style.height = '300px'
  document.body.appendChild(div)
  const graph = new Graph(div, { fitViewOnInit: false, rescalePositions: false, ...config })
  graph.setPointPositions(positions, true)
  graph.render()
  await graph.ready
  try {
    await run(graph, div)
  } finally {
    graph.destroy()
    div.remove()
  }
}

describe('framing a layout larger than the space', () => {
  it('fitView frames a two-million-unit layout instead of stopping at a zoom floor', async () => {
    // A square 2e6 units wide in a 400×300 view at 10% padding fits at zoom
    // 300 · 0.8 / 2e6 = 1.2e-4 — below the 0.001 floor the zoom used to clamp
    // to, which left the fit over 8x too close with the layout's edges off screen.
    const span = 2e6
    const positions = new Float32Array([-span / 2, -span / 2, span / 2, span / 2, 0, 0])
    await withCanvasGraph({ enableSimulation: false }, positions, async (graph, div) => {
      graph.fitViewByPointPositions(Array.from(positions), 0, 0.1)
      // A zero-duration fit still lands through d3's transition timer
      for (let i = 0; i < 50 && graph.getZoomLevel() >= 0.001; i += 1) await wait(20)

      const w = div.clientWidth
      const h = div.clientHeight
      expect(graph.getZoomLevel()).toBeCloseTo((Math.min(w, h) * 0.8) / span, 12)
      // The height binds: the layout spans 80% of it, centred both ways
      const [left, top] = graph.spaceToScreenPosition([-span / 2, span / 2])
      const [right, bottom] = graph.spaceToScreenPosition([span / 2, -span / 2])
      expect(top).toBeCloseTo(h * 0.1, 6)
      expect(bottom).toBeCloseTo(h * 0.9, 6)
      expect(left).toBeCloseTo((w - h * 0.8) / 2, 6)
      expect(right).toBeCloseTo((w + h * 0.8) / 2, 6)
    })
  })
})
