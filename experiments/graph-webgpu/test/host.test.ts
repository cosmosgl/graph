import { Buffer, Texture, luma } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { expect, it, vi } from 'vitest'
import { Graph, LinkStyle } from '../src'

it('composes visual and pick passes on a borrowed WebGPU device', async () => {
  const errors: string[] = []
  const device = await luma.createDevice({
    type: 'webgpu',
    adapters: [webgpuAdapter],
    waitForPageLoad: false,
    createCanvasContext: { canvas: document.createElement('canvas'), autoResize: false },
    onError: err => { errors.push(err.message); return true },
  })
  const canvasTarget = vi.spyOn(device.canvasContext!, 'getCurrentFramebuffer')
  const graph = new Graph(null, {
    spaceSize: 128,
    enableSimulation: false,
    rescalePositions: false,
    pixelRatio: 1,
    pointDefaultSize: 16,
    linkDefaultWidth: 2,
    linkVisibilityMinTransparency: 1,
    linkDefaultArrows: false,
    linkDashLength: 2,
    linkDashGap: 8,
    hoveredLinkWidthIncrease: 8,
    hoveredLinkColor: '#00ff00',
    renderHoveredPointRing: false,
    hoveredPointRingColor: '#ff0000',
  }, Promise.resolve(device))
  const width = 96
  const height = 64
  const target = device.createTexture({ width, height, format: 'rgba8unorm', usage: Texture.RENDER | Texture.COPY_SRC })
  const framebuffer = device.createFramebuffer({ width, height, colorAttachments: [target] })
  const staging = device.createBuffer({ byteLength: 256, usage: Buffer.COPY_DST | Buffer.COPY_SRC })
  const pixel = async (x: number, y: number): Promise<number[]> => {
    device.commandEncoder.copyTextureToBuffer({ sourceTexture: target, destinationBuffer: staging, origin: [x, y, 0], width: 1, height: 1, bytesPerRow: 256 })
    device.submit()
    return Array.from(await staging.readAsync(0, 4))
  }
  const draw = (isPicking = false): void => {
    const pass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0] })
    try {
      graph.drawToRenderPass(pass, isPicking ? { picking: { alpha: 7 / 255, linkIndexOffset: 1000 } } : {})
    } finally { pass.end() }
  }
  try {
    graph.setPointPositions(new Float32Array([32, 64, 96, 64]))
    graph.setLinks(new Float32Array([0, 1]))
    graph.setLinkStyles(new Float32Array([LinkStyle.Dashed]))
    graph.setViewTransform({ k: 1, x: 0, y: 0 }, [width, height])
    graph.render()
    await graph.ready
    graph.renderOneFrame()
    expect(canvasTarget).not.toHaveBeenCalled()
    expect(graph.spaceToScreenPosition([32, 64])).toEqual([16, 32])

    draw(true)
    expect(await pixel(16, 32)).toEqual([1, 0, 0, 7])
    expect(await pixel(80, 32)).toEqual([2, 0, 0, 7])
    // A dash gap belongs to the link in the host's picking pass.
    expect(await pixel(50, 32)).toEqual([233, 3, 0, 7])
    expect(await pixel(16, 46)).toEqual([0, 0, 0, 0])
    draw()
    expect(await pixel(50, 32)).toEqual([0, 0, 0, 0])
    expect(await pixel(16, 41)).toEqual([0, 0, 0, 0])

    graph.setHostHoveredPoint(0)
    graph.setHostHoveredLink(0)
    graph.setConfigPartial({ linkDashLength: 32 })
    draw()
    const ring = await pixel(16, 41)
    expect(ring[0]).toBeGreaterThan(100)
    expect(ring[1]).toBe(0)
    expect((await pixel(32, 35))[1]).toBe(255)
    expect(graph.config.focusedPointIndex).toBeUndefined()
    draw(true)
    expect(await pixel(50, 38)).toEqual([233, 3, 0, 7]) // host pick includes the widened host-hover stroke
    graph.destroy()
    // The host can keep drawing and reading its own targets after the graph releases its resources.
    draw()
    expect(await pixel(16, 32)).toEqual([0, 0, 0, 0])
    expect(errors).toEqual([])
  } finally {
    canvasTarget.mockRestore()
    graph.destroy()
    staging.destroy()
    framebuffer.destroy()
    target.destroy()
    device.destroy()
  }
})
