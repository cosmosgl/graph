import { Buffer, Texture } from '@luma.gl/core'
import { describe, expect, it, vi } from 'vitest'
import { Graph, GraphSimulation, TransitionEasing, type GraphConfig } from '../src'

const config: GraphConfig = {
  spaceSize: 2048,
  enableRenderLoop: false,
  enableSimulation: false,
  fitViewOnInit: false,
  rescalePositions: false,
  pixelRatio: 1,
  linkVisibilityMinTransparency: 1,
  linkDefaultArrows: false,
}
const rebuilds = [
  { name: 'spaceSize', change: { spaceSize: 4096 } },
  { name: 'enableSimulation', change: { enableSimulation: true } },
]
const positions = Float32Array.of(1000, 1000, 1064, 1000)
const colors = Float32Array.of(1, 0, 0, 1, 0, 1, 0, 1)
const sizes = Float32Array.of(24, 8)
const widths = Float32Array.of(12)

async function expectUploadedPixels (graph: Graph): Promise<void> {
  const device = graph.simulation.device!
  const width = 96
  const height = 64
  const size = graph.config.spaceSize
  graph.setViewTransform({
    k: 1,
    x: 16 - (1000 + (width - size) / 2),
    y: 32 - (size - 1000 + (height - size) / 2),
  }, [width, height])
  expect(graph.spaceToScreenPosition([1000, 1000])).toEqual([16, 32])
  const texture = device.createTexture({ width, height, format: 'rgba8unorm', usage: Texture.RENDER | Texture.COPY_SRC })
  const target = device.createFramebuffer({ width, height, colorAttachments: [texture] })
  const bytesPerRow = 512
  const buffer = device.createBuffer({ byteLength: bytesPerRow * height, usage: Buffer.COPY_DST | Buffer.COPY_SRC })
  try {
    const pass = device.beginRenderPass({ framebuffer: target, clearColor: [0, 0, 0, 0] })
    try { graph.drawToRenderPass(pass) } finally { pass.end() }
    device.commandEncoder.copyTextureToBuffer({ sourceTexture: texture, destinationBuffer: buffer, width, height, bytesPerRow })
    device.submit()
    const bytes = await buffer.readAsync()
    const pixel = (x: number, y: number): number[] => Array.from(bytes.slice(y * bytesPerRow + x * 4, y * bytesPerRow + x * 4 + 4))
    expect(pixel(16, 22)).toEqual([255, 0, 0, 255]) // inside the enlarged first point
    expect(pixel(80, 32)).toEqual([0, 255, 0, 255])
    expect(pixel(48, 35)).toEqual([0, 0, 255, 255]) // inside the widened link
    expect(pixel(48, 43)).toEqual([0, 0, 0, 0])
  } finally { buffer.destroy(); target.destroy(); texture.destroy() }
}

describe('public data and config calls before the device is ready', () => {
  describe.each(rebuilds)('rebuilding for $name', ({ change }) => {
    it.each([true, false])('commits pending locations, topology and styles, queued before ready: %s', async beforeReady => {
      const graph = new Graph(null, config)
      try {
        if (!beforeReady) await graph.ready
        graph.setPointPositions(Float32Array.of(960, 1000))
        graph.render(undefined, 0)
        graph.setPointPositions(positions)
        graph.setLinks(Float32Array.of(0, 1))
        graph.setPointColors(colors)
        graph.setLinkColors(Float32Array.of(0, 0, 1, 1))
        graph.setPointSizes(sizes)
        graph.setLinkWidths(widths)
        graph.setConfigPartial(change)
        await graph.ready

        expect(await graph.getPointPositionsAsync()).toEqual(positions)
        expect(graph.getConnectedPointIndices(0)).toEqual([0, 1])
        expect(graph.getPointColors()).toEqual(colors)
        expect(graph.getPointSizes()).toEqual(sizes)
        expect(graph.getLinkWidths()).toEqual(widths)
        await expectUploadedPixels(graph)
        graph.render(undefined, 0)
        await expectUploadedPixels(graph)
      } finally { graph.destroy() }
    })

    it('applies pending standalone positions and links at the config change', async () => {
      const simulation = new GraphSimulation(config)
      try {
        simulation.setPointPositions(Float32Array.of(900, 900))
        simulation.applyData()
        simulation.setPointPositions(positions)
        simulation.setLinks(Float32Array.of(0, 1))
        simulation.setConfig({ ...config, ...change })
        await simulation.ready
        expect(await simulation.getPointPositionsAsync()).toEqual(positions)
        expect(simulation.data.getConnectedPointIndices(0)).toEqual([0, 1])
      } finally { simulation.destroy() }
    })

    it('leaves setters made after the rebuild pending for the next render', async () => {
      const host = document.createElement('div')
      host.style.cssText = 'width:200px;height:200px'
      document.body.append(host)
      const starts = vi.fn()
      const graph = new Graph(host, { ...config, pointDefaultSize: 8, linkDefaultWidth: 1, onTransitionStart: starts })
      try {
        graph.setPointPositions(positions)
        graph.setLinks(Float32Array.of(0, 1))
        graph.render(undefined, 0)
        graph.setConfigPartial(change)
        graph.setPointSizes(sizes)
        graph.setLinkWidths(widths)
        await graph.ready
        expect(graph.getPointRadiusByIndex(0)).toBe(8)
        expect(graph.getLinkWidthByIndex(0)).toBe(1)
        expect(starts).not.toHaveBeenCalled()
        graph.render(undefined, 1000)
        expect(starts).toHaveBeenCalledOnce()
        expect(graph.getPointSizes()).toEqual(sizes)
        expect(graph.getLinkWidths()).toEqual(widths)
      } finally { graph.destroy(); host.remove() }
    })

    it('resolves a setter from the interrupted transition before committing the rebuild', async () => {
      const host = document.createElement('div')
      host.style.cssText = 'width:200px;height:200px'
      document.body.append(host)
      const events: string[] = []
      const callbackXY = Float32Array.of(1300, 1300)
      const graph: Graph = new Graph(host, {
        ...config,
        transitionDuration: 10000,
        onTransitionStart: (): void => { events.push('start') },
        onTransitionEnd: (interrupted): void => {
          events.push(interrupted ? 'interrupt' : 'end')
          if (interrupted) graph.setPointPositions(callbackXY)
        },
        onSimulationStart: (): void => { events.push('simulation start') },
      })
      try {
        graph.setPointPositions(Float32Array.of(1000, 1000))
        graph.render(undefined, 0)
        graph.setPointColors(Float32Array.of(1, 0, 0, 1))
        graph.render()
        graph.setPointPositions(Float32Array.of(1200, 1200))
        graph.setConfigPartial(change)
        await graph.ready
        const expected = change.enableSimulation ? ['start', 'interrupt', 'simulation start'] : ['start', 'interrupt']
        expect(events).toEqual(expected)
        expect(await graph.getPointPositionsAsync()).toEqual(callbackXY)
        graph.render()
        graph.renderOneFrame()
        expect(events).toEqual(expected)
      } finally { graph.destroy(); host.remove() }
    })
  })

  it.each(['transition end', 'simulation start'])('stops queued updates after destruction during %s', async stage => {
    const host = document.createElement('div')
    document.body.append(host)
    const started = vi.fn()
    const graph: Graph = new Graph(host, {
      ...config,
      onTransitionEnd: (): void => { if (stage === 'transition end') graph.destroy() },
      onSimulationStart: (): void => { started(); graph.destroy() },
    })
    try {
      graph.setPointPositions(positions)
      graph.render(undefined, 0)
      graph.setPointColors(colors)
      graph.render(undefined, 1000)
      graph.setConfigPartial({ enableSimulation: true })
      graph.setConfigPartial({ simulationGravity: 0.987 })
      await graph.ready
      expect(graph.isReady).toBe(false)
      expect(started).toHaveBeenCalledTimes(stage === 'simulation start' ? 1 : 0)
      expect(graph.config.simulationGravity).not.toBe(0.987)
    } finally { graph.destroy(); host.remove() }
  })

  it.each(['sizes', 'positions'])('continues active %s when only the space size changes', async channel => {
    const host = document.createElement('div')
    host.style.cssText = 'width:200px;height:200px'
    document.body.append(host)
    const ended = vi.fn()
    const graph = new Graph(host, { ...config, pointDefaultSize: 8, transitionEasing: TransitionEasing.Linear, onTransitionEnd: ended })
    try {
      graph.setPointPositions(Float32Array.of(1000, 1000))
      graph.render(undefined, 0)
      await graph.ready
      let time = performance.now()
      vi.spyOn(performance, 'now').mockImplementation(() => time)
      if (channel === 'sizes') graph.setPointSizes(Float32Array.of(24))
      else graph.setPointPositions(Float32Array.of(1100, 1100))
      graph.render(undefined, 1000)
      time += 500
      graph.renderOneFrame()
      graph.setConfigPartial({ spaceSize: 4096 })
      expect(ended).not.toHaveBeenCalled()
      expect(graph.getPointRadiusByIndex(0)).toBe(channel === 'sizes' ? 16 : 8)
      expect((await graph.getPointPositionsAsync())[0]).toBe(channel === 'sizes' ? 1000 : 1050)
      time += 500
      graph.renderOneFrame()
      expect(ended.mock.calls).toEqual([[false]])
      expect(graph.getPointRadiusByIndex(0)).toBe(channel === 'sizes' ? 24 : 8)
      expect((await graph.getPointPositionsAsync())[0]).toBe(channel === 'sizes' ? 1000 : 1100)
    } finally { vi.restoreAllMocks(); graph.destroy(); host.remove() }
  })

  it('keeps the live trajectory through a style render and starts replacement positions from rest', async () => {
    const options: GraphConfig = { ...config, enableSimulation: true, randomSeed: 29, simulationGravity: 0.5, simulationFriction: 0.7 }
    const straight = new Graph(null, options)
    const edited = new Graph(null, options)
    const fresh = new Graph(null, options)
    try {
      for (const graph of [straight, edited, fresh]) {
        graph.setPointPositions(positions)
        graph.render(1, 0)
      }
      for (let i = 0; i < 3; i++) { straight.step(); edited.step() }
      edited.setPointColors(colors)
      edited.render()
      for (let i = 0; i < 2; i++) { straight.step(); edited.step() }
      await Promise.all([straight.ready, edited.ready, fresh.ready])
      const reference = await straight.getPointPositionsAsync()
      expect(reference).not.toEqual(positions)
      expect(await edited.getPointPositionsAsync()).toEqual(reference)
      edited.setPointPositions(positions.slice())
      edited.render(1, 0)
      edited.step()
      fresh.step()
      expect(await edited.getPointPositionsAsync()).toEqual(await fresh.getPointPositionsAsync())
    } finally { straight.destroy(); edited.destroy(); fresh.destroy() }
  })
})
