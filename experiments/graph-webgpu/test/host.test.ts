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
  const draw = (isPicking = false, pixelRatio?: number, viewport?: [number, number, number, number]): void => {
    const pass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0] })
    try {
      if (viewport) pass.setParameters({ viewport })
      graph.drawToRenderPass(pass, {
        pixelRatio,
        picking: isPicking ? { alpha: 7 / 255, linkIndexOffset: 1000 } : undefined,
      })
    } finally { pass.end() }
  }
  try {
    const swiftShader = device.info.gpuArchitecture?.toLowerCase().includes('swiftshader')
    const { COSMOS_TEST_SWIFTSHADER: requireSwiftShader } = import.meta.env
    if (requireSwiftShader) {
      expect(device.info.type).toBe('webgpu')
      expect(device.info.fallback).toBe(true)
      expect(swiftShader).toBe(true)
    }
    graph.setPointPositions(new Float32Array([32, 64, 96, 64]))
    graph.setLinks(new Float32Array([0, 1]))
    graph.setPointColors(new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]))
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
    // Deck thumbnails move the render viewport inside a shared target. The
    // shader still receives framebuffer-relative fragment coordinates there.
    const thumbnail: [number, number, number, number] = [32, 16, 48, 32]
    graph.setViewTransform({ k: 0.5, x: 12, y: 8 }, [48, 32])
    expect(graph.spaceToScreenPosition([32, 64])).toEqual([8, 16])
    draw(false, 1, thumbnail)
    expect(await pixel(40, 32)).toEqual([255, 0, 0, 255])
    expect(await pixel(72, 32)).toEqual([0, 255, 0, 255])
    draw(true, 1, thumbnail)
    expect(await pixel(40, 32)).toEqual([1, 0, 0, 7])
    expect(await pixel(72, 32)).toEqual([2, 0, 0, 7])
    graph.setViewTransform({ k: 1, x: 0, y: 0 }, [width, height])
    draw()
    expect(await pixel(50, 32)).toEqual([0, 0, 0, 0])
    expect(await pixel(16, 41)).toEqual([0, 0, 0, 0])

    graph.setHostHoveredPoint(0)
    graph.setHostHoveredLink(0)
    graph.setConfigPartial({ linkDashLength: 32 })
    draw()
    // Sample the antialiased red ring at the same device pixel as the WebGL control.
    const ringAlpha = swiftShader ? 100 : 95
    expect(await pixel(16, 41)).toEqual([ringAlpha, 0, 0, ringAlpha])
    expect((await pixel(32, 35))[1]).toBe(255)
    expect(graph.config.focusedPointIndex).toBeUndefined()
    draw(true)
    expect(await pixel(50, 38)).toEqual([233, 3, 0, 7]) // host pick includes the widened host-hover stroke

    // A Retina application can share a graph with a host drawing at one device pixel per CSS pixel.
    graph.setConfigPartial({ pixelRatio: 2 })
    draw(false, 1)
    expect(await pixel(16, 32)).toEqual([255, 0, 0, 255])
    expect(await pixel(80, 32)).toEqual([0, 255, 0, 255])
    draw(true, 1)
    expect(await pixel(16, 32)).toEqual([1, 0, 0, 7])
    expect(await pixel(80, 32)).toEqual([2, 0, 0, 7])
    expect(await pixel(50, 32)).toEqual([233, 3, 0, 7])
    expect(graph.config.pixelRatio).toBe(2)

    // Put the green point directly under the red host-hover ring. The overlay
    // must paint over the green fill, while the host pick still returns point 1.
    graph.setPointPosition(1, 32, 55)
    graph.setHostHoveredPoint(undefined)
    draw(false, 1)
    expect(await pixel(16, 41)).toEqual([0, 255, 0, 255])
    graph.setHostHoveredPoint(0)
    draw(false, 1)
    expect(await pixel(16, 41)).toEqual([ringAlpha, 255 - ringAlpha, 0, 255])
    draw(true, 1)
    expect(await pixel(16, 41)).toEqual([2, 0, 0, 7])

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
