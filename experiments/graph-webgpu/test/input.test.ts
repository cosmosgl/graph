import { expect, it, vi } from 'vitest'
import { Graph } from '../src'
import { GraphRenderer } from '../src/renderer'

it('coalesces stationary hover reads and drops superseded hits while the graph moves', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:200px;height:120px'
  document.body.append(host)
  const entered = vi.fn()
  const left = vi.fn()
  const graph = new Graph(host, {
    enableRenderLoop: false,
    fitViewOnInit: false,
    rescalePositions: false,
    spaceSize: 200,
    pixelRatio: 1,
    pointDefaultSize: 12,
    simulationGravity: 5,
    simulationFriction: 1,
    simulationCenter: 0,
    simulationRepulsion: 0,
    onPointMouseOver: entered,
    onPointMouseOut: left,
  })
  graph.setPointPositions(Float32Array.of(40, 100, 160, 100), true)
  graph.render(1, 0)
  graph.pause()
  const realPick = GraphRenderer.prototype.pick
  const picks = vi.spyOn(GraphRenderer.prototype, 'pick')
  // Hold the notification from the real GPU read so several scene changes land before its answer.
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  picks.mockImplementationOnce(async function (this: GraphRenderer, ...args) {
    const result = await realPick.apply(this, args)
    await held
    return result
  })
  try {
    await graph.ready
    const canvas = host.querySelector('canvas')!
    const { left: x, top: y } = canvas.getBoundingClientRect()
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: x + 40, clientY: y + 60, bubbles: true, view: window }))
    await vi.waitFor(() => expect(picks).toHaveBeenCalledOnce())
    graph.setPointPosition(0, 160, 100)
    for (const nextX of [100, 70, 40]) {
      graph.setPointPosition(1, nextX, 100)
      graph.renderOneFrame()
    }
    expect(picks).toHaveBeenCalledOnce()
    release()
    await vi.waitFor(() => expect(entered.mock.calls.map(([id]) => id)).toEqual([1]))
    expect(picks).toHaveBeenCalledTimes(2)
    expect(left).not.toHaveBeenCalled()
    // Drawing identical frames must not spend more GPU reads on a parked cursor.
    for (let i = 0; i < 4; i++) graph.renderOneFrame()
    expect(picks).toHaveBeenCalledTimes(2)

    graph.step()
    graph.renderOneFrame()
    expect((await graph.getPointPositionsAsync())[2]).toBeGreaterThan(55)
    await vi.waitFor(() => expect(left).toHaveBeenCalledOnce())
    // Leaving before the next hit is delivered must not restore the ring or re-enter point 1.
    const beforeReturn = picks.mock.calls.length
    const started = new Promise<void>(resolve => {
      picks.mockImplementationOnce(function (this: GraphRenderer, ...args) {
        const read = realPick.apply(this, args)
        resolve()
        return read
      })
    })
    graph.setPointPosition(1, 40, 100)
    graph.renderOneFrame()
    await started
    canvas.dispatchEvent(new MouseEvent('mouseleave'))
    expect(await picks.mock.results[beforeReturn]!.value).toEqual({ kind: 'point', index: 1 })
    await graph.getPointPositionsAsync()
    await new Promise(requestAnimationFrame)
    expect(entered).toHaveBeenCalledOnce()
    expect(left).toHaveBeenCalledOnce()
  } finally {
    release()
    picks.mockRestore()
    graph.destroy()
    host.remove()
  }
})

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

it('keeps host link hover styling independent of canvas pointer picks', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:200px;height:120px'
  document.body.append(host)
  const onLinkClick = vi.fn()
  const onBackgroundClick = vi.fn()
  const graph = new Graph(host, {
    spaceSize: 200,
    pixelRatio: 1,
    enableSimulation: false,
    enableRenderLoop: false,
    fitViewOnInit: false,
    rescalePositions: false,
    linkDefaultWidth: 2,
    linkDefaultArrows: false,
    hoveredLinkColor: 'rgba(0,0,0,0)',
    hoveredLinkWidthIncrease: 12,
    onLinkClick,
    onBackgroundClick,
  })
  try {
    await graph.ready
    graph.setPointPositions(new Float32Array([40, 100, 160, 100]), true)
    graph.setLinks(new Float32Array([0, 1]))
    graph.render(1, 0)
    graph.setHostHoveredLink(0)
    const canvas = host.querySelector('canvas')!
    const { left, top } = canvas.getBoundingClientRect()
    const click = (y: number): void => {
      canvas.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, clientX: left + 100, clientY: top + y }))
    }
    // The host hid the visible stroke; a canvas click still uses the pointer's own index.
    click(60)
    await vi.waitFor(() => expect(onLinkClick).toHaveBeenCalledTimes(1))
    expect(onLinkClick.mock.calls[0]?.[0]).toBe(0)
    graph.setConfigPartial({ hoveredLinkColor: 'red' })
    click(67)
    await vi.waitFor(() => expect(onBackgroundClick).toHaveBeenCalledTimes(1))
    expect(onLinkClick).toHaveBeenCalledTimes(1)
  } finally {
    graph.destroy()
    host.remove()
  }
})

it('uses the fractional pointer position for repulsion and accepts a standalone mouse event', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:12px;top:12px;width:200px;height:120px'
  document.body.append(host)
  const graph = new Graph(host, {
    enableRenderLoop: false,
    enableRightClickRepulsion: true,
    fitViewOnInit: false,
    rescalePositions: false,
    simulationGravity: 0,
    simulationRepulsion: 0,
  })
  graph.setPointPositions(Float32Array.of(2048, 2048))
  graph.render(1, 0)
  try {
    await graph.ready
    graph.pause()
    const canvas = host.querySelector('canvas')!
    graph.setViewTransform({ k: 0.125, x: 0, y: 0 }, [200, 120])
    const bounds = canvas.getBoundingClientRect()
    const step = vi.spyOn(graph.simulation, 'runSimulationStep')
    const pointer = (type: string, buttons: number): void => {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        pointerType: 'mouse',
        pointerId: 1,
        isPrimary: true,
        buttons,
        clientX: bounds.left + 74.25,
        clientY: bounds.top + 60.75,
      }))
    }
    const observed = (): readonly [number, number] | undefined => {
      graph.renderOneFrame()
      return step.mock.lastCall?.[1]
    }
    pointer('pointermove', 2)
    expect(observed()).toEqual(graph.screenToSpacePosition([74.25, 60.75]))
    pointer('pointermove', 0)
    expect(observed()).toBeUndefined()
    pointer('pointerdown', 2)
    pointer('pointercancel', 0)
    expect(observed()).toBeUndefined()
    canvas.dispatchEvent(new MouseEvent('mousedown', {
      view: window,
      bubbles: true,
      button: 2,
      buttons: 2,
      clientX: bounds.left + 81,
      clientY: bounds.top + 51,
    }))
    expect(observed()).toEqual(graph.screenToSpacePosition([81, 51]))
    canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(observed()).toBeUndefined()
  } finally { graph.destroy(); host.remove() }
})
