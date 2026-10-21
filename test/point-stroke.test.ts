import { describe, it, expect } from 'vitest'
import { luma, type Buffer, type Device } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { Graph } from '@cosmos.gl/graph'

const STROKE_BUFFERS = ['sourceStrokeColorBuffer', 'targetStrokeColorBuffer', 'sourceStrokeWidthBuffer', 'targetStrokeWidthBuffer'] as const

type StrokeResources = Record<typeof STROKE_BUFFERS[number], Buffer | undefined> & {
  previousStrokeColorData: Float32Array | undefined;
  previousStrokeWidthData: Float32Array | undefined;
}

/** An external device lets the tests draw exact pixels and detect resources surviving graph destruction. */
const createScene = async (): Promise<{
  graph: Graph;
  device: Device;
  pixelAt: (spaceSize: number, x: number) => number[];
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
  }, Promise.resolve(device))
  graph.setPointPositions(new Float32Array([1000, 1000]))
  graph.render()
  await graph.ready
  const texture = device.createTexture({ format: 'rgba8unorm', width: 200, height: 200 })
  const framebuffer = device.createFramebuffer({ width: 200, height: 200, colorAttachments: [texture] })
  const pixelAt = (spaceSize: number, x: number): number[] => {
    graph.setViewTransform({ k: 1, x: 100 - (1000 + (200 - spaceSize) / 2), y: 100 - ((spaceSize - 1000) + (200 - spaceSize) / 2) }, [200, 200])
    const pass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0] })
    graph.drawToRenderPass(pass)
    pass.end()
    device.submit()
    const pixels = device.readPixelsToArrayWebGL(framebuffer) as Uint8Array
    const offset = (99 * 200 + x) * 4
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

describe('point stroke resources', () => {
  it('releases stroke buffers and CPU snapshots without destroying the host device', async () => {
    const { graph, device, destroy } = await createScene()
    try {
      const resources = graph.simulation.points as unknown as StrokeResources
      const buffers = STROKE_BUFFERS.map(key => resources[key])
      expect(buffers.every(buffer => buffer && !buffer.destroyed)).toBe(true)
      graph.destroy()
      expect(buffers.every(buffer => buffer?.destroyed)).toBe(true)
      for (const key of STROKE_BUFFERS) expect(resources[key]).toBeUndefined()
      expect(resources.previousStrokeColorData).toBeUndefined()
      expect(resources.previousStrokeWidthData).toBeUndefined()
      const hostBuffer = device.createBuffer({ data: new Float32Array([1]) })
      hostBuffer.destroy()
    } finally {
      destroy()
    }
  })
})

describe.each(['spaceSize', 'enableSimulation'] as const)('stroke inputs pending before %s changes', change => {
  it('uploads the new color and width, and preserves the fill when the stroke is disabled again', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      expect(pixelAt(2048, 109)).toEqual([255, 0, 0, 255])
      graph.setPointStrokeColors(new Float32Array([0, 0, 1, 1]))
      graph.setPointStrokeWidths(new Float32Array([4]))
      graph.setConfigPartial(change === 'spaceSize' ? { spaceSize: 4096 } : { enableSimulation: true })
      graph.render()
      const spaceSize = change === 'spaceSize' ? 4096 : 2048
      expect(pixelAt(spaceSize, 109)).toEqual([0, 0, 255, 255])
      expect(pixelAt(spaceSize, 100)).toEqual([255, 0, 0, 255])
      graph.setPointStrokeWidths(new Float32Array([0]))
      graph.render()
      expect(pixelAt(spaceSize, 109)).toEqual([255, 0, 0, 255])
    } finally {
      destroy()
    }
  })
})
