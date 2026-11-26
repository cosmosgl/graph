import { expect, it, vi } from 'vitest'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'

it.each(['webgl', 'webgpu'] as const)('visits the midway view and allows a newer camera command to interrupt a long %s zoom', async engine => {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  try {
    const doc = frame.contentDocument!
    const host = doc.createElement('div')
    host.style.cssText = 'position:relative;width:256px;height:256px'
    doc.body.append(host)
    const GRAPH = await loadGraphPackage(engine, doc)
    const stops: number[] = []
    const graph = new GRAPH(host, {
      spaceSize: 4096,
      enableSimulation: false,
      enableRenderLoop: false,
      rescalePositions: false,
      fitViewOnInit: false,
      onZoomEnd: (event): void => { stops.push(event.transform.k) },
    })
    try {
      await graph.ready
      graph.setPointPositions(Float32Array.of(2048, 2048, 3400, 2048, NaN, NaN))
      graph.render(0, 0)
      graph.setZoomTransformByPointPositions(Float32Array.of(2048, 2048), 0, 4)
      await vi.waitFor(() => expect(stops.at(-1)).toBe(4), { timeout: 5000 })
      stops.length = 0
      graph.zoomToPointByIndex(1, 160, 2)
      await vi.waitFor(() => expect(stops.at(-1)).toBe(2), { timeout: 5000 })
      expect(stops).toEqual([1, 2])
      expect(graph.spaceToScreenPosition([3400, 2048])).toEqual([128, 128])
      stops.length = 0
      // A near target has one stage. The current scale prevents zoom-out when requested.
      graph.zoomToPointByIndex(1, 40, 1, false)
      await vi.waitFor(() => expect(stops).toEqual([2]), { timeout: 5000 })

      // Replacing a far zoom cancels both the running and scheduled half of the flight.
      stops.length = 0
      graph.zoomToPointByIndex(0, 200, 6)
      await vi.waitFor(() => expect(graph.getZoomLevel()).not.toBe(2), { interval: 10 })
      graph.setZoomLevel(3, 0)
      await new Promise(resolve => setTimeout(resolve, 225))
      expect(graph.getZoomLevel()).toBe(3)
      expect(stops).not.toContain(6)

      stops.length = 0
      // The replacement can arrive before WebGPU's one-point read finishes.
      graph.zoomToPointByIndex(0, 100, 7)
      graph.setZoomLevel(5, 0)
      await new Promise(resolve => setTimeout(resolve, 140))
      expect(graph.getZoomLevel()).toBe(5)
      expect(stops).not.toContain(7)

      stops.length = 0
      graph.zoomToPointByIndex(1, 120, 6)
      const canvas = host.querySelector('canvas')!
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true }))
      const wheelZoom = graph.getZoomLevel()
      expect(wheelZoom).toBeLessThan(5)
      await new Promise(resolve => setTimeout(resolve, 175))
      expect(graph.getZoomLevel()).toBe(wheelZoom)
      expect(stops).not.toContain(6)

      stops.length = 0
      graph.zoomToPointByIndex(2, 0, 8)
      graph.zoomToPointByIndex(99, 0, 8)
      await new Promise(resolve => setTimeout(resolve, 65))
      expect(stops).toEqual([])
    } finally { graph.destroy() }
  } finally { frame.remove() }
})
