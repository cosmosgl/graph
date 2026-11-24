import { RenderKernel } from '@luma.gl/graph'
import { expect, it, vi } from 'vitest'
import { Graph, type GraphConfig } from '../src'

it('occludes dense links only under fully opaque point pixels on an owned canvas', async () => {
  const width = 64
  const height = 48
  const host = document.createElement('div')
  host.style.cssText = `width:${width}px;height:${height}px`
  document.body.append(host)
  const config: GraphConfig = {
    spaceSize: 64,
    pixelRatio: 1,
    fitViewOnInit: false,
    initialZoomLevel: 1,
    rescalePositions: false,
    enableSimulation: false,
    enableRenderLoop: false,
    backgroundColor: '#000000',
    linkDefaultColor: '#0000ff',
    linkDefaultWidth: 6,
    linkVisibilityMinTransparency: 1,
    pointGreyoutOpacity: 0.25,
    transitionDuration: 0,
  }
  const graph = new Graph(host, config)
  let borrowed: Graph | undefined
  const draws = vi.spyOn(RenderKernel.prototype, 'draw')
  try {
    // A blue link passes under overlapping translucent and opaque circles. The
    // other links have zero length, meeting the density threshold on a small canvas.
    const links = new Float32Array(width * height * 2)
    links[1] = 1
    function load (g: Graph): void {
      g.setPointPositions(new Float32Array([3, 32, 61, 32, 20.25, 32.25, 29.25, 32.25, 47.25, 32.25]), true)
      g.setPointSizes(new Float32Array([0, 0, 14, 14, 14]))
      g.setPointColors(new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0.5, 1, 0, 1, 1,
      ]))
      g.setLinks(links)
      g.render(0, 0)
    }
    await graph.ready
    load(graph)
    const copy = document.createElement('canvas')
    copy.width = width
    copy.height = height
    const ctx = copy.getContext('2d', { willReadFrequently: true })!
    ctx.globalCompositeOperation = 'copy'
    const canvas = host.querySelector('canvas')!
    expect([canvas.width, canvas.height]).toEqual([width, height])

    function checkDepthDraws (active: boolean): void {
      const kernels = draws.mock.contexts.filter((kernel): kernel is RenderKernel => kernel instanceof RenderKernel)
      const states = kernels.map(kernel => kernel.pipeline.props.parameters)
      expect(states).toHaveLength(active ? 3 : 2)
      expect(states.some(state => state?.depthWriteEnabled)).toBe(active)
      expect(states.some(state => state?.depthCompare === 'less')).toBe(active)
    }
    function capture (g: Graph, active: boolean): Uint8ClampedArray {
      draws.mockClear()
      g.renderOneFrame()
      checkDepthDraws(active)
      ctx.drawImage(canvas, 0, 0)
      return ctx.getImageData(0, 0, width, height).data
    }
    function sample (bytes: Uint8ClampedArray, x: number): number[] {
      const at = graph.spaceToScreenPosition([x, 32.25])
      const i = (Math.floor(at[1]) * width + Math.floor(at[0])) * 4
      return Array.from(bytes.slice(i, i + 4))
    }
    for (const highlighted of [false, true]) {
      graph.setConfigPartial({ pointOcclusionCulling: true })
      graph.setConfigPartial({ highlightedPointIndices: highlighted ? [2] : undefined })
      const actual = capture(graph, true)
      graph.setConfigPartial({ pointOcclusionCulling: false })
      const reference = capture(graph, false)
      expect(actual.findIndex((channel, i) => channel !== reference[i])).toBe(-1)
      expect(sample(actual, 20.25)).toEqual([255, 0, 0, 255])
      if (highlighted) {
        // The fully opaque magenta point becomes translucent, revealing the link.
        expect(sample(actual, 47.25)[0]).toBeLessThan(200)
        expect(sample(actual, 47.25)[2]).toBeGreaterThan(160)
      } else {
        expect(sample(actual, 47.25)).toEqual([255, 0, 255, 255])
        const translucent = sample(actual, 29.25)
        expect(Math.abs(translucent[1]! - 128)).toBeLessThanOrEqual(1)
        expect(Math.abs(translucent[2]! - 128)).toBeLessThanOrEqual(1)
      }
    }

    const device = graph.simulation.device!
    graph.setConfigPartial({ pointOcclusionCulling: true })
    const pass = device.beginRenderPass({ framebuffer: device.canvasContext!.getCurrentFramebuffer(), clearDepth: 0.25 })
    draws.mockClear()
    try { graph.drawToRenderPass(pass) } finally { pass.end() }
    checkDepthDraws(false)
    device.submit()

    // Even its default framebuffer belongs to the caller when a device is supplied.
    borrowed = new Graph(host, config, Promise.resolve(device))
    await borrowed.ready
    load(borrowed)
    const begin = vi.spyOn(device, 'beginRenderPass')
    try {
      const borrowedFrame = capture(borrowed, false)
      expect(sample(borrowedFrame, 20.25)).toEqual([255, 0, 0, 255])
      expect(begin.mock.calls.at(-1)?.[0]?.clearDepth).toBe(false)
    } finally { begin.mockRestore() }
  } finally {
    draws.mockRestore()
    borrowed?.destroy()
    graph.destroy()
    host.remove()
  }
})
