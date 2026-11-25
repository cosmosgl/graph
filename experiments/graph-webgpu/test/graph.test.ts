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
  it('uploads only the link-width channel when a width edit is the only pending setter', async () => {
    const { graph, cleanup } = mountedGraph()
    try {
      await graph.ready
      const device = graph.simulation.device!
      const allocations = vi.spyOn(device, 'createBuffer')
      const prototype: Buffer = Object.getPrototypeOf(graph.getPointPositionBuffer()!.buffer)
      const writes = vi.spyOn(prototype, 'write')
      function uploadedBytes (id: string): number {
        let bytes = 0
        for (const [props] of allocations.mock.calls) {
          if ('id' in props && props.id === id) bytes += props.data?.byteLength ?? 0
        }
        for (const [i, [data]] of writes.mock.calls.entries()) {
          const buffer = writes.mock.contexts[i]
          if (buffer instanceof Buffer && buffer.id === id) bytes += data.byteLength
        }
        return bytes
      }
      try {
        // Establish that the spies observe the normal point-style and draw-order uploads.
        graph.render(undefined, 0)
        expect(uploadedBytes('cosmos-point-style')).toBeGreaterThan(0)
        expect(uploadedBytes('cosmos-point-order')).toBeGreaterThan(0)
        for (const [width, duration] of [[4, 0], [12, 1000], [2, 1000]] as const) {
          writes.mockClear()
          allocations.mockClear()
          graph.setLinkWidths(Float32Array.of(width))
          graph.render(undefined, duration)
          expect(uploadedBytes('cosmos-point-style')).toBe(0)
          expect(uploadedBytes('cosmos-point-order')).toBe(0)
          expect(uploadedBytes('cosmos-link-widths') + uploadedBytes('cosmos-link-style')).toBe(Float32Array.BYTES_PER_ELEMENT)
        }
      } finally { writes.mockRestore(); allocations.mockRestore() }
    } finally { cleanup() }
  })

  it('applies queued point and simulation edits alongside a link-width setter', async () => {
    const onLinkClick = vi.fn()
    const onBackgroundClick = vi.fn()
    const { host, graph, cleanup } = mountedGraph({ onLinkClick, onBackgroundClick })
    try {
      await graph.ready
      const shapes = Float32Array.of(0, 0, 0)
      graph.setPointShapes(shapes)
      graph.render(undefined, 0)
      shapes[0] = 1
      graph.setLinkWidths(Float32Array.of(4))
      graph.setPointShapes(shapes)
      graph.render(undefined, 0)
      expect(graph.graph.pointShapes?.[0]).toBe(1)
      expect(graph.getLinkWidthByIndex(0)).toBe(4)

      // The composed simulation can stage topology without going through Graph.setLinks.
      graph.simulation.setLinks(Float32Array.of(0, 1, 1, 0))
      graph.setLinkWidths(Float32Array.of(8, 16))
      graph.render(undefined, 0)
      expect(graph.getLinkWidths()).toEqual(Float32Array.of(8, 16))
      const canvas = host.querySelector('canvas')!
      const { left, top } = canvas.getBoundingClientRect()
      const [x, y] = graph.spaceToScreenPosition([2048, 2048])
      const clickMidpoint = (): void => {
        canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: left + x, clientY: top + y }))
      }
      clickMidpoint()
      await vi.waitFor(() => expect(onLinkClick).toHaveBeenCalledOnce())

      // Direct applyData clears the simulation's pending flags. Its new endpoints must still reach the drawing buffers.
      graph.simulation.setLinks(Float32Array.of(0, 0, 1, 1))
      graph.simulation.applyData()
      graph.setLinkWidths(Float32Array.of(16, 8))
      graph.render(undefined, 0)
      clickMidpoint()
      await vi.waitFor(() => expect(onBackgroundClick).toHaveBeenCalledOnce())
    } finally { cleanup() }
  })

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

  it('excludes a fading point from selection, tracking and collision until its slot is restored', async () => {
    const { graph, cleanup } = mountedGraph({ simulationGravity: 0, simulationCollision: 1 })
    try {
      await graph.ready
      const present = Float32Array.of(2000, 2048, 2004, 2048, 2140, 2048)
      graph.setPinnedPoints([])
      graph.setPointPositions(present)
      graph.render(1, 0)
      graph.trackPointPositionsByIndices([0, 1, 2])
      const select = (): Promise<number[] | null> => graph.findPointsInRectAsync([[0, 0], [320, 200]])
      expect(await select()).toEqual([0, 1, 2])
      let now = performance.now()
      const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
      try {
        const missing = present.slice()
        missing[3] = NaN // Either missing coordinate removes the whole slot.
        graph.setPointPositions(missing)
        graph.render(1, 1000)
        now += 500
        graph.renderOneFrame()
        expect(await select()).toEqual([0, 2])
        expect([...(await graph.getTrackedPointPositionsMapAsync())!]).toEqual([[0, [2000, 2048]], [2, [2140, 2048]]])
        const removed = Float32Array.of(2000, 2048, NaN, NaN, 2140, 2048)
        expect(await graph.getPointPositionsAsync()).toEqual(removed)

        now += 500
        graph.renderOneFrame()
        graph.step()
        expect(await graph.getPointPositionsAsync()).toEqual(removed)

        graph.setPointPositions(present)
        graph.render(1, 1000)
        expect(await select()).toEqual([0, 1, 2])
        expect((await graph.getTrackedPointPositionsMapAsync())?.get(1)).toEqual([2004, 2048])
        now += 1000
        graph.renderOneFrame()
        graph.step()
        // The same two overlapping slots collide as soon as both are live again.
        const after = await graph.getPointPositionsAsync()
        expect(after[0]).toBeLessThan(present[0]!)
        expect(after[2]).toBeGreaterThan(present[2]!)
        expect(after.slice(4)).toEqual(present.slice(4))
      } finally { clock.mockRestore() }
    } finally { cleanup() }
  })

  it('keeps explicit size and color channels while fading default color channels in a sparse slot', async () => {
    const { host, graph, cleanup } = mountedGraph({ backgroundColor: '#000', pointDefaultColor: '#f00', enableSimulation: false })
    try {
      await graph.ready
      graph.setLinks(new Float32Array())
      graph.setPointSizes(Float32Array.of(24, NaN, NaN))
      graph.setPointColors(Float32Array.of(NaN, 0.25, 0, 1, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN))
      graph.render(undefined, 0)
      const canvas = host.querySelector('canvas')!
      const copy = document.createElement('canvas')
      copy.width = canvas.width
      copy.height = canvas.height
      const context = copy.getContext('2d', { willReadFrequently: true })!
      const [x, y] = graph.spaceToScreenPosition([2000, 2048])
      // Eight pixels from the center is inside the explicit size and outside a half-sized point.
      const sample = (): number[] => {
        graph.renderOneFrame()
        context.drawImage(canvas, 0, 0)
        return Array.from(context.getImageData(x + 8, y, 1, 1).data)
      }
      let now = performance.now()
      const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
      try {
        expect(sample()).toEqual([255, 64, 0, 255])
        const missing = positions()
        missing[0] = NaN
        graph.setPointPositions(missing)
        graph.render(undefined, 1000)
        now += 500
        expect(sample()).toEqual([128, 64, 0, 255])
        now += 500
        expect(sample()).toEqual([0, 0, 0, 255])
      } finally { clock.mockRestore() }
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
