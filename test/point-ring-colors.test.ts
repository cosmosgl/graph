import { describe, it, expect, vi } from 'vitest'
import { luma, type Buffer, type Device } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'
import { Graph } from '@cosmos.gl/graph'

/** An external device lets the tests draw exact pixels and detect resources surviving graph destruction. */
const createScene = async (ringColors?: Float32Array): Promise<{
  graph: Graph;
  device: Device;
  pixelAt: (spaceSize: number, x: number, y?: number, picking?: boolean) => number[];
  destroy: () => void;
}> => {
  const device = await luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: { canvas: document.createElement('canvas') },
  })
  const graph = new Graph(null, {
    spaceSize: 2048,
    pixelRatio: 1,
    enableSimulation: false,
    rescalePositions: false,
    scalePointsOnZoom: false,
    pointDefaultSize: 24,
    pointDefaultColor: '#ff0000',
    outlinedPointIndices: [0],
    transitionDuration: 0,
  }, Promise.resolve(device))
  if (ringColors) graph.setPointRingColors(ringColors)
  graph.setPointPositions(new Float32Array([1000, 1000]))
  graph.render()
  await graph.ready
  const texture = device.createTexture({ format: 'rgba8unorm', width: 200, height: 200 })
  const framebuffer = device.createFramebuffer({ width: 200, height: 200, colorAttachments: [texture] })
  const pixelAt = (spaceSize: number, x: number, y = 99, picking = false): number[] => {
    graph.setViewTransform({ k: 1, x: 100 - (1000 + (200 - spaceSize) / 2), y: 100 - ((spaceSize - 1000) + (200 - spaceSize) / 2) }, [200, 200])
    const pass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0] })
    graph.drawToRenderPass(pass, picking ? { picking: { alpha: 1 } } : undefined)
    pass.end()
    device.submit()
    const pixels = device.readPixelsToArrayWebGL(framebuffer) as Uint8Array
    const offset = (y * 200 + x) * 4
    return Array.from(pixels.subarray(offset, offset + 4))
  }
  const destroy = (): void => {
    graph.destroy()
    framebuffer.destroy()
    texture.destroy()
    device.canvasContext?.destroy()
    device.destroy()
  }
  return { graph, device, pixelAt, destroy }
}

const expectColor = (actual: number[], expected: number[]): void => {
  actual.forEach((channel, i) => expect(Math.abs(channel - (expected[i] as number))).toBeLessThanOrEqual(1))
}

describe('outer ring colors', () => {
  it('uploads ring colors only once when positions and colors change together', async () => {
    const { graph, pixelAt, destroy } = await createScene(new Float32Array([0, 0, 1, 1]))
    try {
      expectColor(pixelAt(2048, 114), [0, 0, 255, 255])
      const resources = graph.simulation.points as unknown as { ringColorBuffer: Buffer }
      const write = vi.spyOn(resources.ringColorBuffer, 'write')
      graph.setPointPositions(new Float32Array([1000, 1000]))
      graph.setPointRingColors(new Float32Array([0, 1, 0, 1]))
      graph.render()
      expect(write).toHaveBeenCalledTimes(1)
      expectColor(pixelAt(2048, 114), [0, 255, 0, 255])
      write.mockClear()
      graph.setPointPositions(new Float32Array([1000, 1000]))
      graph.render()
      expect(write).toHaveBeenCalledTimes(1)
      expectColor(pixelAt(2048, 114), [0, 255, 0, 255])
    } finally { destroy() }
  })

  it('does not reconcile an intentionally absent ring buffer during visible or picking draws', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      const points = graph.simulation.points
      if (!points) throw new Error('Expected initialized point renderer')
      const reconcile = vi.spyOn(points, 'updateRingColor')
      expectColor(pixelAt(2048, 114), [255, 255, 255, 255])
      expectColor(pixelAt(2048, 114), [255, 255, 255, 255])
      expectColor(pixelAt(2048, 100, 99, true), [1, 0, 0, 255])
      expect(reconcile).not.toHaveBeenCalled()
    } finally { destroy() }
  })

  it('allocates a ring attribute only for supplied colors and releases it when the channel no longer matches', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    const resources = graph.simulation.points as unknown as {
      ringColorBuffer: Buffer | undefined;
      drawCommand: { bufferLayout: { name: string }[] };
    }
    const hasRingAttribute = (): boolean => resources.drawCommand.bufferLayout.some(attribute => attribute.name === 'pointRingColor')
    try {
      expectColor(pixelAt(2048, 114), [255, 255, 255, 255])
      expect(resources.ringColorBuffer).toBeUndefined()
      expect(hasRingAttribute()).toBe(false)
      graph.setConfigPartial({ outlinedPointRingColor: 'auto' })
      const automatic = pixelAt(2048, 114)
      expect(resources.ringColorBuffer).toBeUndefined()
      expect(hasRingAttribute()).toBe(false)

      graph.setPointRingColors(new Float32Array([0, 0, 1, 1]))
      graph.render()
      expectColor(pixelAt(2048, 114), [0, 0, 255, 255])
      const buffer = resources.ringColorBuffer
      expect(buffer?.byteLength).toBe(16)
      expect(hasRingAttribute()).toBe(true)
      graph.setPointRingColors(new Float32Array(0))
      graph.render()
      expect(pixelAt(2048, 114)).toEqual(automatic)
      expect(buffer?.destroyed).toBe(true)
      expect(resources.ringColorBuffer).toBeUndefined()
      expect(hasRingAttribute()).toBe(false)

      graph.setPointRingColors(new Float32Array([1, 0, 0, 1]))
      graph.render()
      pixelAt(2048, 114)
      const recreated = resources.ringColorBuffer
      graph.destroy()
      expect(recreated?.destroyed).toBe(true)
    } finally { destroy() }
  })

  it('retains an outgoing stroke while enabling and disabling per-point ring colors', async () => {
    const div = document.createElement('div')
    div.style.cssText = 'width:200px;height:200px'
    document.body.appendChild(div)
    const graph = new Graph(div, { enableSimulation: false, enableRenderLoop: false, fitViewOnInit: false })
    try {
      graph.setPointPositions(new Float32Array([2000, 2000]))
      graph.setPointStrokeWidths(new Float32Array([4]))
      graph.render(undefined, 0)
      await graph.ready
      graph.renderOneFrame()
      const resources = graph.simulation.points as unknown as {
        targetStrokeWidthBuffer: Buffer | undefined;
        drawCommand: { bufferLayout: { name: string }[] };
      }
      const stroke = resources.targetStrokeWidthBuffer
      expect(stroke).toBeDefined()
      graph.setPointStrokeWidths(new Float32Array([0]))
      graph.setPointRingColors(new Float32Array([0, 0, 1, 1]))
      graph.render(undefined, 10000)
      graph.renderOneFrame()
      expect(resources.drawCommand.bufferLayout.some(attribute => attribute.name === 'sourceStrokeColor')).toBe(true)
      expect(resources.drawCommand.bufferLayout.some(attribute => attribute.name === 'pointRingColor')).toBe(true)
      expect(stroke?.destroyed).toBe(false)
      graph.setPointRingColors(new Float32Array(0))
      graph.render(undefined, 10000)
      graph.renderOneFrame()
      expect(resources.drawCommand.bufferLayout.some(attribute => attribute.name === 'sourceStrokeColor')).toBe(true)
      expect(resources.drawCommand.bufferLayout.some(attribute => attribute.name === 'pointRingColor')).toBe(false)
      expect(stroke?.destroyed).toBe(false)
    } finally {
      graph.destroy()
      div.remove()
    }
  })

  it('uses the white default, explicit RGBA, and whole-point NaN fallback without changing the fill', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      expectColor(pixelAt(2048, 114), [255, 255, 255, 255])
      graph.setPointRingColors(new Float32Array([0, 0, 1, 1]))
      graph.render()
      expectColor(pixelAt(2048, 114), [0, 0, 255, 255])
      expectColor(pixelAt(2048, 100), [255, 0, 0, 255])
      graph.setConfigPartial({ outlinedPointRingColor: '#00ff00' })
      expectColor(pixelAt(2048, 114), [0, 0, 255, 255])
      graph.setPointRingColors(new Float32Array([NaN, 0, 1, 1]))
      graph.render()
      expectColor(pixelAt(2048, 114), [0, 255, 0, 255])
      graph.setConfigPartial({ outlinedPointRingColor: '#ff00ff' })
      expectColor(pixelAt(2048, 114), [255, 0, 255, 255])
    } finally { destroy() }
  })

  it('derives shades from the fill, including NaN fallback, and preserves input arrays', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      const colors = new Float32Array([NaN, NaN, NaN, NaN])
      graph.setPointRingColors(colors)
      graph.render()
      graph.setConfigPartial({ outlinedPointRingColor: 'darken', outlinedPointRingContrast: 0.16 })
      const dark = pixelAt(2048, 114)
      graph.setConfigPartial({ outlinedPointRingColor: 'lighten' })
      const light = pixelAt(2048, 114)
      const luminance = (c: number[]): number => 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number)
      expect(luminance(light)).toBeGreaterThan(luminance(dark))
      graph.setConfigPartial({ outlinedPointRingColor: 'auto' })
      expect(pixelAt(2048, 114)).toEqual(dark)
      expect(Array.from(colors).every(Number.isNaN)).toBe(true)
      graph.setPointRingColors(new Float32Array([0, 0, 1, 1]))
      graph.render()
      graph.setConfigPartial({ spaceSize: 4096 })
      expectColor(pixelAt(4096, 114), [0, 0, 255, 255])
    } finally { destroy() }
  })

  it('applies pending colors on a config rebuild and falls back when the point count changes', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      graph.setPointRingColors(new Float32Array([0, 0, 1, 1]))
      graph.setConfigPartial({ spaceSize: 4096 })
      expectColor(pixelAt(4096, 114), [0, 0, 255, 255])
      graph.setPointPositions(new Float32Array([1000, 1000, 1100, 1000]))
      graph.render()
      expectColor(pixelAt(4096, 114), [255, 255, 255, 255])
      const resources = graph.simulation.points as unknown as { ringColorBuffer: Buffer | undefined }
      expect(resources.ringColorBuffer).toBeUndefined()
      graph.setPointRingColors(new Float32Array([0, 1, 0, 1, NaN, NaN, NaN, NaN]))
      graph.render()
      expectColor(pixelAt(4096, 114), [0, 255, 0, 255])
      expect(resources.ringColorBuffer?.byteLength).toBe(32)
      graph.setPointPositions(new Float32Array([1000, 1000]))
      graph.render()
      expectColor(pixelAt(4096, 114), [255, 255, 255, 255])
      expect(resources.ringColorBuffer).toBeUndefined()
    } finally { destroy() }
  })

  it('lightens dark fills automatically and respects per-point alpha and ring visibility', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      graph.setPointColors(new Float32Array([0, 0, 1, 1]))
      graph.render()
      graph.setConfigPartial({ outlinedPointRingColor: 'lighten' })
      const light = pixelAt(2048, 114)
      graph.setConfigPartial({ outlinedPointRingColor: 'auto' })
      expect(pixelAt(2048, 114)).toEqual(light)
      graph.setPointRingColors(new Float32Array([0, 0, 1, 0.5]))
      graph.render()
      expectColor(pixelAt(2048, 114), [0, 0, 127, 127])
      graph.setConfigPartial({ outlinedPointIndices: undefined })
      expectColor(pixelAt(2048, 114), [0, 0, 0, 0])
      expectColor(pixelAt(2048, 100), [0, 0, 255, 255])
    } finally { destroy() }
  })

  it.each([
    ['#000000', [33, 33, 122, 254]],
    ['#ffffff', [165, 165, 254, 254]],
  ] as const)('dims explicit rings independently of body opacity on %s', async (backgroundColor, expected) => {
    const { graph, pixelAt, destroy } = await createScene(new Float32Array([0, 0, 1, 1]))
    try {
      graph.setConfigPartial({ backgroundColor, pointOpacity: 0 })
      expectColor(pixelAt(2048, 114), [0, 0, 255, 255])
      expectColor(pixelAt(2048, 100), [0, 0, 0, 0])
      graph.setConfigPartial({ highlightedPointIndices: [], pointGreyoutOpacity: 0, pointGreyoutColor: '#00ff00' })
      expectColor(pixelAt(2048, 114), [...expected])
      expectColor(pixelAt(2048, 100), [0, 0, 0, 0])
    } finally { destroy() }
  })

  it('derives greyed rings from the original fill, then dims them like explicit colors', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      graph.setConfigPartial({ outlinedPointRingColor: 'auto', backgroundColor: '#000000' })
      const original = pixelAt(2048, 114)
      // Readback is premultiplied: divide by coverage to reproduce the original resolved color.
      const alpha = original[3] as number
      graph.setPointRingColors(new Float32Array([
        (original[0] as number) / alpha, (original[1] as number) / alpha, (original[2] as number) / alpha, 1,
      ]))
      graph.render()
      graph.setConfigPartial({ highlightedPointIndices: [], pointGreyoutColor: '#00ff00', pointGreyoutOpacity: 0 })
      const explicit = pixelAt(2048, 114)
      graph.setPointRingColors(new Float32Array([NaN, NaN, NaN, NaN]))
      graph.render()
      expectColor(pixelAt(2048, 114), explicit)
    } finally { destroy() }
  })
})
