import { Buffer, type Device, luma } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/core/webgl'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { describe, expect, it, vi } from 'vitest'
import { Graph, GraphSimulation, type GraphConfig } from '../src'

const config: GraphConfig = {
  enableRenderLoop: false,
  fitViewOnInit: false,
  rescalePositions: false,
  pixelRatio: 1,
  simulationGravity: 0.5,
  simulationCenter: 0,
  simulationLinkSpring: 0,
  simulationRepulsion: 0,
  transitionDuration: 0,
  pointDefaultSize: 12,
}
const positions = (): Float32Array => new Float32Array([2000, 2048, 2096, 2048, NaN, NaN])

function mountedGraph (overrides?: GraphConfig): { host: HTMLDivElement; graph: Graph; cleanup: () => void } {
  const host = document.createElement('div')
  host.style.cssText = 'width:320px;height:200px'
  document.body.append(host)
  const graph = new Graph(host, { ...config, ...overrides })
  graph.setPointPositions(positions())
  graph.setLinks(new Float32Array([0, 1]))
  graph.setPinnedPoints([0])
  graph.render(1, 0)
  graph.pause()
  return { host, graph, cleanup: (): void => { graph.destroy(); host.remove() } }
}

async function expectBorrowedDeviceUsable (device: Device): Promise<void> {
  const buffer = device.createBuffer({ byteLength: 4, usage: Buffer.COPY_DST | Buffer.COPY_SRC })
  try {
    const bytes = new Uint8Array([1, 2, 3, 4])
    buffer.write(bytes)
    expect(await buffer.readAsync()).toEqual(bytes)
  } finally { buffer.destroy() }
}

describe('WebGPU Graph', () => {
  it('honors queued public calls, steps resident positions, snaps sparse edits and preserves the point index space', async () => {
    const { host, graph, cleanup } = mountedGraph()
    try {
      await graph.ready
      expect(graph.simulation.device?.info.type).toBe('webgpu')
      expect(host.querySelector('canvas')?.width).toBe(320)
      expect(graph.isSimulationRunning).toBe(false)
      expect(await graph.getPointPositionsAsync()).toEqual(positions())
      const before = graph.getPointPositionBuffer()!
      graph.step()
      const after = await graph.getPointPositionsAsync()
      expect(after[0]).toBe(2000)
      expect(after[2]).toBeLessThan(2096)
      expect(after[2]).toBeGreaterThan(2048)
      expect(after[4]).toBeNaN()
      expect(graph.getPointPositionBuffer()!.version).toBeGreaterThan(before.version)
      graph.setPointPositionsByIndices([0, 1], new Float32Array([2010, 2048, 2100, 2058]))
      expect(Array.from((await graph.getPointPositionsAsync()).slice(0, 4))).toEqual([2010, 2048, 2100, 2058])
      expect(graph.getNeighboringPointIndices(0)).toEqual([1])
      graph.setPointPositions(new Float32Array())
      graph.setLinks(new Float32Array())
      graph.render()
      expect(await graph.getPointPositionsAsync()).toHaveLength(0)
    } finally { cleanup() }
    expect(host.childElementCount).toBe(0)
  })

  it('selects and tracks the points in the captured view, discarding requests invalidated by replacement', async () => {
    const { graph, cleanup } = mountedGraph()
    try {
      await graph.ready
      expect(graph.spaceToScreenPosition([2000, 2048])).toEqual([112, 100])
      expect(await graph.findPointsInRectAsync([[114, 94], [118, 105]])).toEqual([0])
      expect(await graph.findPointsInPolygonAsync([[100, 90], [130, 90], [112, 125]])).toEqual([0])
      graph.trackPointPositionsByIndices([1, 2, 0])
      expect([...(await graph.getTrackedPointPositionsMapAsync())!]).toEqual([[1, [2096, 2048]], [0, [2000, 2048]]])
      const oldSelection = graph.findPointsInRectAsync([[0, 0], [320, 200]])
      const oldTrack = graph.getTrackedPointPositionsMapAsync()
      graph.setPointPositions(new Float32Array([2048, 2048]))
      graph.setLinks(new Float32Array())
      graph.render()
      expect(await oldSelection).toBeNull()
      expect(await oldTrack).toBeNull()
      graph.setViewTransform({ k: 2, x: -160, y: -100 })
      expect(await graph.findPointsInRectAsync([[165, 105], [155, 95]])).toEqual([0])
    } finally { cleanup() }
  })

  it('runs standalone on a borrowed device and leaves the host usable', async () => {
    const host = new GraphSimulation(config)
    let simulation: GraphSimulation | undefined
    try {
      await host.ready
      simulation = new GraphSimulation(config, Promise.resolve(host.device!))
      simulation.setPointPositions(positions(), true)
      simulation.setPinnedPoints([0])
      simulation.applyData(1)
      await simulation.ready
      simulation.step()
      const xy = await simulation.getPointPositionsAsync()
      expect(xy[0]).toBe(2000)
      expect(xy[2]).toBeLessThan(2096)
      simulation.destroy()
      host.setPointPositions(positions(), true)
      host.applyData(1)
      expect(await host.getPointPositionsAsync()).toEqual(positions())
    } finally { simulation?.destroy(); host.destroy() }
  })

  it('keeps the frontmost sample per label cell and gathers link midpoints and tracked IDs', async () => {
    const { graph, cleanup } = mountedGraph({ pointSamplingDistance: 400, linkSamplingDistance: 400 })
    try {
      await graph.ready
      graph.setPointRenderOrder([1, 0])
      graph.render()
      await vi.waitFor(() => expect([...graph.getSampledPointPositionsMap()]).toEqual([[0, [2000, 2048]]]))
      await vi.waitFor(() => expect(graph.getSampledLinks().indices).toEqual([0]))
      expect(graph.getSampledLinks().positions).toEqual([2048, 2048])
      graph.trackPointPositionsByIndices([1, 2])
      await vi.waitFor(() => expect([...graph.getTrackedPointPositionsMap()]).toEqual([[1, [2096, 2048]]]))
      graph.setPointPosition(1, 2100, 2050)
      await vi.waitFor(() => expect(graph.getTrackedPointPositionsMap().get(1)).toEqual([2100, 2050]))
    } finally { cleanup() }
  })

  it('interpolates live positions, keeps pin edits and snaps sparse updates while other points finish their tween', async () => {
    const ended = vi.fn()
    const { graph, cleanup } = mountedGraph({ onTransitionEnd: ended })
    try {
      await graph.ready
      let clock = performance.now()
      const time = vi.spyOn(performance, 'now').mockImplementation(() => clock)
      try {
        graph.setPointPositions(new Float32Array([2010, 2048, 2196, 2048, NaN, NaN]), true)
        graph.render(undefined, 100)
        graph.setPinnedPoint(1, true)
        clock += 50
        graph.renderOneFrame()
        expect((await graph.getPointPositionsAsync())[2]).toBeCloseTo(2146)
        clock += 50
        graph.renderOneFrame()
        expect((await graph.getPointPositionsAsync())[2]).toBe(2196)
        expect(ended).toHaveBeenCalledWith(false)
        graph.step()
        expect((await graph.getPointPositionsAsync())[2]).toBe(2196)
        graph.setPointPositions(positions(), true)
        graph.render(undefined, 100)
        ended.mockClear()
        graph.setPointPositionsByIndices([1, 2, 0], [2077, 2055, 12, 12, NaN, 27])
        clock += 50
        graph.renderOneFrame()
        expect(await graph.getPointPositionsAsync()).toEqual(new Float32Array([2005, 2048, 2077, 2055, NaN, NaN]))
        expect(ended).not.toHaveBeenCalled()
        clock += 50
        graph.renderOneFrame()
        expect(ended).toHaveBeenCalledExactlyOnceWith(false)
        expect(await graph.getPointPositionsAsync()).toEqual(new Float32Array([2000, 2048, 2077, 2055, NaN, NaN]))
      } finally { time.mockRestore() }
    } finally { cleanup() }
  })

  it('rejects queued work when the browser cannot provide a WebGPU adapter', async () => {
    const { gpu } = navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }
    const request = vi.spyOn(gpu, 'requestAdapter').mockResolvedValueOnce(null)
    const host = document.createElement('div')
    const tick = vi.fn()
    const graph = new Graph(host, { ...config, onSimulationTick: tick })
    try {
      graph.setPointPositions(positions())
      graph.render(1, 0)
      graph.step()
      await expect(graph.ready).rejects.toThrow(/webgpu adapter/i)
      expect(request).toHaveBeenCalledOnce()
      expect(graph.isReady).toBe(false)
      expect(graph.getPointPositionBuffer()).toBeUndefined()
      expect(tick).not.toHaveBeenCalled()
      expect(host.childElementCount).toBe(0)
    } finally { request.mockRestore(); graph.destroy() }
  })

  it('rejects a borrowed WebGL2 device and returns it usable to its owner', async () => {
    const device = await luma.createDevice({
      type: 'webgl', adapters: [webgl2Adapter], createCanvasContext: { canvas: document.createElement('canvas') }, waitForPageLoad: false,
    })
    const host = document.createElement('div')
    const graph = new Graph(host, config, Promise.resolve(device))
    try {
      graph.render()
      await expect(graph.ready).rejects.toThrow(/requires a WebGPU device/)
      expect(host.childElementCount).toBe(0)
      await expectBorrowedDeviceUsable(device)
    } finally { graph.destroy(); device.destroy() }
  })

  it('releases partial renderer allocations when a borrowed device has no canvas for an interactive Graph', async () => {
    const device = await luma.createDevice({ type: 'webgpu', adapters: [webgpuAdapter], waitForPageLoad: false, createCanvasContext: undefined })
    const buffers = vi.spyOn(device, 'createBuffer')
    const textures = vi.spyOn(device, 'createTexture')
    const vertices = vi.spyOn(device, 'createVertexArray')
    const framebuffers = vi.spyOn(device, 'createFramebuffer')
    const allocations = [buffers, textures, vertices, framebuffers]
    const host = document.createElement('div')
    const graph = new Graph(host, config, Promise.resolve(device))
    try {
      graph.setPointPositions(positions())
      graph.render()
      await expect(graph.ready).rejects.toThrow(/requires an HTML canvas/)
      expect(host.childElementCount).toBe(0)
      expect(graph.simulation.isReady).toBe(false)
      expect(graph.getPointPositionBuffer()).toBeUndefined()
      for (const created of allocations) {
        expect(created).toHaveBeenCalled()
        for (const result of created.mock.results) expect(result.value.destroyed).toBe(true)
      }
      await expectBorrowedDeviceUsable(device)
    } finally {
      for (const created of allocations) created.mockRestore()
      graph.destroy()
      device.destroy()
    }
  })

  it('propagates a rejected host device promise and releases an early destroy', async () => {
    const host = document.createElement('div')
    const graph = new Graph(host, config, Promise.reject(new Error('WebGPU device unavailable')))
    await expect(graph.ready).rejects.toThrow('WebGPU device unavailable')
    expect(host.childElementCount).toBe(0)
    const clicked = vi.fn()
    const early = new Graph(host, { ...config, onPointClick: clicked })
    early.setPointPositions(positions())
    early.render()
    early.destroy()
    await early.ready
    expect(host.childElementCount).toBe(0)
    expect(early.isReady).toBe(false)
    expect(clicked).not.toHaveBeenCalled()
  })
})
