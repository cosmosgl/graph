import { expect, it, vi } from 'vitest'
import { Graph } from '../src'

it('resolves the pressed point, buffers early movement, preserves grab offset and pans the background', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:200px;height:120px;margin:20px'
  document.body.append(host)
  const onPointClick = vi.fn()
  const onPointMouseOver = vi.fn()
  const onDragStart = vi.fn()
  const onDrag = vi.fn()
  const onDragEnd = vi.fn()
  const onZoomStart = vi.fn()
  const onZoom = vi.fn()
  const graph = new Graph(host, {
    enableDrag: true,
    enableSimulation: false,
    fitViewOnInit: false,
    rescalePositions: false,
    enableRenderLoop: false,
    pixelRatio: 1,
    spaceSize: 200,
    pointDefaultSize: 20,
    transitionDuration: 0,
    onPointClick,
    onPointMouseOver,
    onDragStart,
    onDrag,
    onDragEnd,
    onZoomStart,
    onZoom,
  })
  const original = new Float32Array([60, 100, 140, 100])
  graph.setPointPositions(original)
  graph.setPinnedPoints([0])
  graph.render()
  try {
    await graph.ready
    const canvas = host.querySelector('canvas')!
    const mouse = (type: string, x: number, y: number, buttons = 0, target: EventTarget = canvas): void => {
      const { top, left } = canvas.getBoundingClientRect()
      target.dispatchEvent(new MouseEvent(type, { view: window, bubbles: true, cancelable: true, buttons, clientX: left + x, clientY: top + y }))
    }
    // Prime the old hover on point 0. Press directly on point 1 with no intervening mousemove.
    mouse('mousemove', 60, 60)
    await vi.waitFor(() => expect(onPointMouseOver.mock.calls[0]?.[0]).toBe(0))
    mouse('mousedown', 144, 57, 1)
    mouse('mousemove', 155, 50, 1, window)
    await vi.waitFor(() => expect(onDrag).toHaveBeenCalledTimes(1))
    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(onZoomStart).not.toHaveBeenCalled()
    expect(graph.isPointPinned(1)).toBe(true)
    expect(await graph.getPointPositionsAsync()).toEqual(new Float32Array([60, 100, 151, 107]))
    mouse('mouseup', 155, 50, 0, window)
    expect(onDragEnd).toHaveBeenCalledTimes(1)
    expect(graph.isPointPinned(1)).toBe(false)
    expect(graph.isPointPinned(0)).toBe(true)

    // The previous point remains in the hover cache. A background press must start a pan.
    mouse('mousedown', 20, 30, 1)
    mouse('mousemove', 32, 38, 1, window)
    await vi.waitFor(() => expect(onZoom).toHaveBeenCalledTimes(1))
    mouse('mouseup', 32, 38, 0, window)
    expect(onDragStart).toHaveBeenCalledTimes(1)
    expect(graph.spaceToScreenPosition([60, 100])).toEqual([72, 68])

    // These actions occur in one browser turn, before the pending GPU result is available.
    mouse('mousedown', 72, 68, 1)
    mouse('mouseup', 72, 68, 0, window)
    // Allow D3's one-turn click suppression after the preceding pan to expire.
    await new Promise(resolve => setTimeout(resolve, 0))
    mouse('click', 72, 68)
    await vi.waitFor(() => expect(onPointClick).toHaveBeenCalledTimes(1))
    expect(onPointClick.mock.calls[0]?.[0]).toBe(0)
    expect(onDragStart).toHaveBeenCalledTimes(1)

    mouse('mousedown', 72, 68, 1)
    graph.setPointPositions(new Float32Array([80, 80]))
    graph.render()
    mouse('mousemove', 110, 80, 1, window)
    // A completed later GPU click provides a fence for the earlier invalidated press.
    mouse('click', 92, 88)
    await vi.waitFor(() => expect(onPointClick).toHaveBeenCalledTimes(2))
    mouse('mouseup', 110, 80, 0, window)
    expect(await graph.getPointPositionsAsync()).toEqual(new Float32Array([80, 80]))
    expect(onDragStart).toHaveBeenCalledTimes(1)

    graph.setPinnedPoint(0, false)
    mouse('mousedown', 92, 88, 1)
    await vi.waitFor(() => expect(graph.isPointPinned(0)).toBe(true))
    window.dispatchEvent(new Event('blur'))
    expect(graph.isPointPinned(0)).toBe(false)
    expect(onDragEnd).toHaveBeenCalledTimes(2)

    mouse('mousedown', 30, 20, 1)
    await vi.waitFor(() => expect(onZoomStart).toHaveBeenCalledTimes(2))
    graph.destroy()
    const zoomCalls = onZoom.mock.calls.length
    mouse('mousemove', 42, 28, 1, window)
    expect(onZoom).toHaveBeenCalledTimes(zoomCalls)
  } finally {
    graph.destroy()
    host.remove()
  }
})
