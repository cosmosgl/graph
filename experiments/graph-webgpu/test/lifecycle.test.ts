import { describe, expect, it, vi } from 'vitest'
import { Graph, GraphSimulation } from '../src'

describe('WebGPU graph lifecycle', () => {
  it('shares completed centroids with Graph and invalidates in-flight reads on membership edits', async () => {
    const graph = new Graph(null, { rescalePositions: false })
    const simulation = graph.simulation
    try {
      graph.setPointPositions(Float32Array.of(10, 20, 30, 40))
      graph.setPointClusters([0, 1])
      graph.render(0, 0)
      await graph.ready
      const initial = await simulation.getClusterPositionsAsync()
      expect(initial).toEqual([10, 20, 30, 40])
      initial[0] = 0
      expect(graph.getClusterPositions()).toEqual([10, 20, 30, 40])
      const pending = graph.getClusterPositionsAsync()
      simulation.setPointClusters([0, 0])
      simulation.applyData(0)
      expect(await pending).toEqual([])
      expect(simulation.getClusterPositions()).toEqual([])
      await expect.poll(() => graph.getClusterPositions()).toEqual([20, 30])
      const moving = simulation.getClusterPositionsAsync()
      simulation.step()
      expect(await moving).toEqual([20, 30])
      const discarded = simulation.getClusterPositionsAsync()
      graph.destroy()
      expect(await discarded).toEqual([])
      expect(graph.getClusterPositions()).toEqual([])
    } finally { graph.destroy() }
  })

  it('replays mixed pre-ready simulation operations in order', async () => {
    const simulation = new GraphSimulation({
      simulationGravity: 1,
      simulationFriction: 1,
      simulationCenter: 0,
      simulationRepulsion: 0,
      rescalePositions: false,
      spaceSize: 100,
    })
    try {
      simulation.setPointPositions(new Float32Array([0, 0]))
      simulation.applyData(1)
      simulation.step()
      simulation.setPointPositions(new Float32Array([20, 20]))
      simulation.applyData(1)
      simulation.setPointPosition(0, 30, 30)
      simulation.setConfig({ spaceSize: 200 })
      simulation.step()
      await simulation.ready
      expect(await simulation.getPointPositionsAsync()).toEqual(new Float32Array([37, 37]))
    } finally { simulation.destroy() }
  })

  it('rebuilds pending inputs on live space changes and simulation re-enable', async () => {
    const starts = vi.fn()
    const ends = vi.fn()
    const graph = new Graph(null, {
      rescalePositions: false,
      spaceSize: 100,
      simulationGravity: 0,
      simulationCenter: 0,
      simulationRepulsion: 0,
      simulationFriction: 0,
      simulationCollision: 1,
      pointDefaultSize: 4,
      randomSeed: 4,
      onSimulationStart: starts,
      onSimulationEnd: ends,
    })
    try {
      await graph.ready
      graph.setPointPositions(new Float32Array([0, 0, 2, 0]))
      graph.setPinnedPoints([0])
      graph.render(1, 0)
      graph.setConfigPartial({ pointDefaultSize: 10 })
      graph.step()
      expect(await graph.getPointPositionsAsync()).toEqual(new Float32Array([0, 0, 6, 0]))
      graph.setPointPositions(new Float32Array([Infinity, 0]))
      graph.setConfigPartial({ backgroundColor: 'red' })
      expect(graph.getPointPositionBuffer()?.count).toBe(2)
      expect(graph.graph.pointsNumber).toBe(2)
      graph.setConfigPartial({ spaceSize: 200 })
      expect(graph.simulation.store.worldOrigin).toEqual([100, 100])
      expect(await graph.getPointPositionsAsync()).toEqual(new Float32Array([200, 0]))
      graph.setConfigPartial({ enableSimulation: false })
      expect(ends).toHaveBeenCalledOnce()
      graph.setPointPositions(new Float32Array([20, 30]))
      graph.setConfigPartial({ enableSimulation: true })
      expect(starts).toHaveBeenCalledOnce()
      expect(graph.isSimulationRunning).toBe(true)
      expect(await graph.getPointPositionsAsync()).toEqual(new Float32Array([20, 30]))
      graph.setConfig({ enableSimulation: false, randomSeed: 99 })
      expect(graph.config.spaceSize).toBe(4096)
      expect(graph.config.randomSeed).toBe(4)
    } finally { graph.destroy() }
  })

  it('draws a manual resize immediately and consumes the pending idle frame', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:120px;height:80px'
    document.body.append(host)
    const graph = new Graph(host, { pixelRatio: 2, enableSimulation: false, fitViewOnInit: false })
    try {
      await graph.ready
      graph.setPointPositions(Float32Array.of(20, 20))
      graph.render(0, 0)
      const canvas = host.querySelector('canvas')!
      host.style.width = '150px'
      graph.renderOneFrame()
      expect([canvas.width, canvas.height]).toEqual([300, 160])
      const draw = vi.spyOn(graph, 'renderOneFrame')
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
      expect(draw).not.toHaveBeenCalled()
    } finally { graph.destroy(); host.remove() }
  })

  it('coalesces autonomous draws behind a busy GPU and delivers the requested redraw after a pause', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:120px;height:80px'
    document.body.append(host)
    const tick = vi.fn()
    const graph = new Graph(host, { enableRenderLoop: false, fitViewOnInit: false, onSimulationTick: tick })
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    try {
      await graph.ready
      graph.setPointPositions(new Float32Array([20, 20]))
      graph.render(1, 0)
      const device = graph.simulation.device!
      const createFence = device.createFence.bind(device)
      vi.spyOn(device, 'createFence').mockImplementationOnce(() => {
        const fence = createFence()
        // Deterministically delay the completion notification of this real GPU frame.
        Object.defineProperty(fence, 'signaled', { value: fence.signaled.then(() => held) })
        return fence
      })
      const draw = vi.spyOn(graph, 'renderOneFrame')
      graph.setConfigPartial({ enableRenderLoop: true })
      await vi.waitFor(() => expect(tick).toHaveBeenCalledOnce())
      graph.pause()
      graph.setHostHoveredPoint(0)
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame)
      expect(draw).toHaveBeenCalledOnce()
      graph.step()
      expect(tick).toHaveBeenCalledTimes(2)
      release()
      await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(2))
      expect(tick).toHaveBeenCalledTimes(2)
    } finally { release(); graph.destroy(); host.remove() }
  })

  it('tears down after device loss and renders again on a fresh device', async () => {
    const host = document.createElement('div')
    host.style.cssText = 'width:120px;height:80px'
    document.body.append(host)
    const create = (): Graph => new Graph(host, { enableRenderLoop: false, rescalePositions: false, fitViewOnInit: false })
    const old = create()
    let next: Graph | undefined
    try {
      await old.ready
      old.setPointPositions(new Float32Array([20, 20]))
      old.render()
      const device = old.simulation.device!
      device.destroy()
      await device.lost
      expect(old.isReady).toBe(false)
      expect(old.getPointPositionBuffer()).toBeUndefined()
      expect(host.querySelector('canvas')).toBeNull()
      next = create()
      next.setPointPositions(new Float32Array([40, 25]))
      next.render()
      await next.ready
      expect(host.querySelector('canvas')).not.toBeNull()
      expect(await next.getPointPositionsAsync()).toEqual(new Float32Array([40, 25]))
      expect(next.simulation.device).not.toBe(device)
    } finally { next?.destroy(); old.destroy(); host.remove() }
  })
})
