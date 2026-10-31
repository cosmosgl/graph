import { describe, expect, it } from 'vitest'
import { luma } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'
import { Graph } from '@cosmos.gl/graph'

describe('resolving link defaults', () => {
  it('preserves caller NaNs and resolves updated defaults in getters and rendering', async () => {
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
      pointDefaultSize: 0,
      linkDefaultColor: '#ff0000',
      linkDefaultWidth: 8,
      scaleLinksOnZoom: false,
      linkOpacity: 1,
    }, Promise.resolve(device))
    const colors = new Float32Array([NaN, NaN, NaN, 1])
    const widths = new Float32Array([NaN])
    const texture = device.createTexture({ format: 'rgba8unorm', width: 200, height: 200 })
    const framebuffer = device.createFramebuffer({ width: 200, height: 200, colorAttachments: [texture] })
    try {
      graph.setPointPositions(new Float32Array([900, 1000, 1100, 1000]))
      graph.setLinks(new Float32Array([0, 1]))
      graph.setLinkColors(colors)
      graph.setLinkWidths(widths)
      graph.render()
      await graph.ready
      graph.setViewTransform({ k: 1, x: 100 - (1000 + (200 - 2048) / 2), y: 100 - ((2048 - 1000) + (200 - 2048) / 2) }, [200, 200])
      const pixel = (): number[] => {
        const pass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0] })
        graph.drawToRenderPass(pass)
        pass.end()
        device.submit()
        const pixels = device.readPixelsToArrayWebGL(framebuffer) as Uint8Array
        return Array.from(pixels.subarray((100 * 200 + 100) * 4, (100 * 200 + 100) * 4 + 4))
      }
      expect(Array.from(graph.getLinkColors())).toEqual([1, 0, 0, 1])
      expect(Array.from(graph.getLinkWidths())).toEqual([8])
      const red = pixel()
      expect(red[0]).toBeGreaterThan(0)
      expect(red[1]).toBe(0)
      graph.setConfigPartial({ linkDefaultColor: '#00ff00', linkDefaultWidth: 4 })
      graph.render()
      expect(Array.from(graph.getLinkColors())).toEqual([0, 1, 0, 1])
      expect(Array.from(graph.getLinkWidths())).toEqual([4])
      expect(graph.getLinkWidthByIndex(0)).toBe(4)
      const green = pixel()
      expect(green[0]).toBe(0)
      expect(green[1]).toBeGreaterThan(0)
      const tuple: [number, number, number, number] = [1, 0, 0, 1]
      graph.setConfigPartial({ linkDefaultColor: tuple })
      expect(Array.from(graph.getLinkColors())).toEqual([1, 0, 0, 1])
      tuple[0] = 0
      tuple[2] = 1
      graph.setConfigPartial({ linkDefaultColor: tuple })
      expect(Array.from(graph.getLinkColors())).toEqual([0, 0, 1, 1])
      expect(Number.isNaN(colors[0])).toBe(true)
      expect(Number.isNaN(widths[0])).toBe(true)
      widths[0] = 6
      graph.setLinks(new Float32Array([0, 1]))
      graph.render()
      expect(Array.from(graph.getLinkWidths())).toEqual([6])
    } finally {
      graph.destroy()
      framebuffer.destroy()
      texture.destroy()
      device.canvasContext?.destroy()
      device.destroy()
    }
  })
})
