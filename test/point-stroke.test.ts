import { describe, it, expect } from 'vitest'
import { luma, type Buffer, type Device } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { Graph, PointShape } from '@cosmos.gl/graph'

const STROKE_BUFFERS = ['sourceStrokeColorBuffer', 'targetStrokeColorBuffer', 'sourceStrokeWidthBuffer', 'targetStrokeWidthBuffer'] as const

type StrokeResources = Record<typeof STROKE_BUFFERS[number], Buffer | undefined> & {
  previousStrokeColorData: Float32Array | undefined;
  previousStrokeWidthData: Float32Array | undefined;
  drawCommand: { bufferLayout: { name: string }[] } | undefined;
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
      // The buffers exist only once some point can have a stroke
      graph.setPointStrokeWidths(new Float32Array([1]))
      graph.render()
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

describe('stroke on small points', () => {
  it('skips the stroke where no fill would remain, and keeps it where fill does', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      graph.setPointStrokeColors(new Float32Array([0, 0, 1, 1]))
      // A 4 px point with a 2.5 px stroke: the bands from both edges meet before the centre
      graph.setPointSizes(new Float32Array([4]))
      graph.setPointStrokeWidths(new Float32Array([2.5]))
      graph.render()
      expect(pixelAt(2048, 100)).toEqual([255, 0, 0, 255])
      // A 12 px point with a 2 px stroke: fill at the centre, stroke in the band
      graph.setPointSizes(new Float32Array([12]))
      graph.setPointStrokeWidths(new Float32Array([2]))
      graph.render()
      expect(pixelAt(2048, 100)).toEqual([255, 0, 0, 255])
      expect(pixelAt(2048, 104)).toEqual([0, 0, 255, 255])
    } finally {
      destroy()
    }
  })
})

describe('stroke shader variant', () => {
  it('compiles the stroke in only once a width asks for it, and out again when none is left', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      const points = graph.simulation.points as unknown as StrokeResources
      const hasStrokeAttributes = (): boolean => points.drawCommand!.bufferLayout.some(l => l.name === 'sourceStrokeColor')
      // Width 0 everywhere: no stroke attributes, no stroke buffers, the plain fill
      expect(pixelAt(2048, 109)).toEqual([255, 0, 0, 255])
      expect(hasStrokeAttributes()).toBe(false)
      expect(points.targetStrokeColorBuffer).toBeUndefined()
      // A color array alone does not switch the stroke on
      graph.setPointStrokeColors(new Float32Array([0, 0, 1, 1]))
      graph.render()
      expect(pixelAt(2048, 109)).toEqual([255, 0, 0, 255])
      expect(hasStrokeAttributes()).toBe(false)
      // A default width does: the rebuilt models carry the attributes and the pending color
      graph.setConfigPartial({ pointDefaultStrokeWidth: 4 })
      graph.render()
      expect(pixelAt(2048, 109)).toEqual([0, 0, 255, 255])
      expect(hasStrokeAttributes()).toBe(true)
      // Back to 0: compiled out again, buffers released, fill restored
      graph.setConfigPartial({ pointDefaultStrokeWidth: 0 })
      graph.render()
      expect(pixelAt(2048, 109)).toEqual([255, 0, 0, 255])
      expect(hasStrokeAttributes()).toBe(false)
      expect(points.targetStrokeColorBuffer).toBeUndefined()
    } finally {
      destroy()
    }
  })
})

describe('stroke transitions', () => {
  it('the first stroke change on a rendered graph animates from the default, not from itself', async () => {
    const { graph, destroy } = await createScene()
    try {
      const points = graph.simulation.points as unknown as StrokeResources
      // Rendered at width 0, so no stroke is compiled in; now a width and a color arrive together
      graph.setPointStrokeWidths(new Float32Array([4]))
      graph.setPointStrokeColors(new Float32Array([0, 0, 1, 1]))
      graph.render()
      // The queued transition mixes source → target: the source must still be the default
      // the point was drawn with (NaN), or the stroke snaps in at full width and color
      const floats = (bytes: Uint8Array): Float32Array => new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
      const sourceWidth = floats(await points.sourceStrokeWidthBuffer!.readAsync())
      const sourceColor = floats(await points.sourceStrokeColorBuffer!.readAsync())
      expect(Number.isNaN(sourceWidth[0])).toBe(true)
      expect(Array.from(sourceColor).every(Number.isNaN)).toBe(true)
    } finally {
      destroy()
    }
  })
})

describe('stroke cutoff on non-circular shapes', () => {
  it('uses the shape\'s own depth, not the circle\'s half diameter', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      graph.setPointStrokeColors(new Float32Array([0, 0, 1, 1]))
      graph.setPointSizes(new Float32Array([12]))
      // A 12 px square's centre is 4.8 px from its edge (half-size 0.8 of the radius):
      // a 5.5 px stroke leaves no fill, so none is drawn...
      graph.setPointShapes(new Float32Array([PointShape.Square]))
      graph.setPointStrokeWidths(new Float32Array([5.5]))
      graph.render()
      expect(pixelAt(2048, 100)).toEqual([255, 0, 0, 255])
      // ...while a 3 px stroke fits: fill at the centre, stroke 1.3 px inside the edge
      graph.setPointStrokeWidths(new Float32Array([3]))
      graph.render()
      expect(pixelAt(2048, 100)).toEqual([255, 0, 0, 255])
      expect(pixelAt(2048, 103)).toEqual([0, 0, 255, 255])
      // A 12 px cross arm is 1.8 px from its centre line to its edge: a 2 px stroke leaves no fill
      graph.setPointShapes(new Float32Array([PointShape.Cross]))
      graph.setPointStrokeWidths(new Float32Array([2]))
      graph.render()
      expect(pixelAt(2048, 100)).toEqual([255, 0, 0, 255])
    } finally {
      destroy()
    }
  })
})
