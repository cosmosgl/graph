import { describe, it, expect } from 'vitest'
import { luma } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { GraphData } from '@/graph/modules/GraphData'
import { defaultConfigValues } from '@/graph/variables'

/**
 * `setPointRenderOrder`: how an order resolves to a back-to-front permutation, and
 * that the GPU draws by it. Every test here pins behavior that already works.
 */

/** Resolves `order` against `pointsNumber` points; `undefined` means index order. */
const resolve = (pointsNumber: number, order: ArrayLike<number> | undefined): number[] | undefined => {
  const data = new GraphData(defaultConfigValues)
  data.inputPointPositions = new Float32Array(pointsNumber * 2)
  data.inputPointRenderOrder = order
  data.update()
  return data.pointRenderOrder && Array.from(data.pointRenderOrder)
}

describe('resolving a render order', () => {
  it('draws a partial list on top in list order, with the rest underneath in index order', () => {
    expect(resolve(8, [7, 2])).toEqual([0, 1, 3, 4, 5, 6, 7, 2])
  })

  it('gives a repeated index its last position', () => {
    expect(resolve(6, [3, 5, 3])).toEqual([0, 1, 2, 4, 5, 3])
  })

  it('ignores entries that are not point indices', () => {
    expect(resolve(4, [-1, 1.5, NaN, 4, 0])).toEqual([1, 2, 3, 0])
  })

  it('takes a full permutation as is', () => {
    expect(resolve(4, new Uint32Array([3, 1, 0, 2]))).toEqual([3, 1, 0, 2])
  })

  it('leaves the order unset when it resolves to index order', () => {
    expect(resolve(4, undefined)).toBeUndefined()
    expect(resolve(4, [])).toBeUndefined()
    expect(resolve(4, [0, 1, 2, 3])).toBeUndefined()
    // The last point is already on top
    expect(resolve(4, [3])).toBeUndefined()
    expect(resolve(4, [9])).toBeUndefined()
  })

  it('applies an out-of-range index once the point count grows, and drops it when it shrinks', () => {
    const data = new GraphData(defaultConfigValues)
    data.inputPointRenderOrder = [5, 0]
    data.inputPointPositions = new Float32Array(4 * 2)
    data.update()
    expect(Array.from(data.pointRenderOrder ?? [])).toEqual([1, 2, 3, 0])
    data.inputPointPositions = new Float32Array(6 * 2)
    data.update()
    expect(Array.from(data.pointRenderOrder ?? [])).toEqual([1, 2, 3, 4, 5, 0])
    data.inputPointPositions = new Float32Array(4 * 2)
    data.update()
    expect(Array.from(data.pointRenderOrder ?? [])).toEqual([1, 2, 3, 0])
  })

  it('re-resolves an array edited in place once it is set again', () => {
    const data = new GraphData(defaultConfigValues)
    const order = [1]
    data.inputPointPositions = new Float32Array(4 * 2)
    data.inputPointRenderOrder = order
    data.update()
    expect(Array.from(data.pointRenderOrder ?? [])).toEqual([0, 2, 3, 1])
    order[0] = 2
    data.inputPointRenderOrder = order
    data.update()
    expect(Array.from(data.pointRenderOrder ?? [])).toEqual([0, 1, 3, 2])
  })
})

/**
 * All points at one spot and one sampling cell for the whole canvas: the sample
 * reports the point drawn last, so it reads the render order back from the GPU.
 */
const SPACE_SIZE = 4096
const CONFIG: GraphConfig = {
  spaceSize: SPACE_SIZE,
  enableSimulation: false,
  fitViewOnInit: false,
  pointSamplingDistance: 1000,
}

const stackedPositions = (pointsNumber: number): Float32Array =>
  new Float32Array(pointsNumber * 2).fill(SPACE_SIZE / 2)

const createCanvasGraph = (): { graph: Graph; destroy: () => void } => {
  const div = document.createElement('div')
  div.style.width = '200px'
  div.style.height = '200px'
  document.body.appendChild(div)
  const graph = new Graph(div, CONFIG)
  return { graph, destroy: (): void => { graph.destroy(); div.remove() } }
}

const topPoint = (graph: Graph): number | undefined => {
  const { indices } = graph.getSampledPoints()
  expect(indices).toHaveLength(1)
  return indices[0]
}

describe('drawing by the render order', () => {
  it('draws the highest index on top when no order is set', async () => {
    const { graph, destroy } = createCanvasGraph()
    try {
      graph.setPointPositions(stackedPositions(4))
      graph.render()
      await graph.ready
      expect(topPoint(graph)).toBe(3)
    } finally {
      destroy()
    }
  })

  it('draws the listed point on top, and goes back to index order on null', async () => {
    const { graph, destroy } = createCanvasGraph()
    try {
      graph.setPointPositions(stackedPositions(4))
      graph.render()
      await graph.ready
      graph.setPointRenderOrder([0])
      graph.render()
      expect(topPoint(graph)).toBe(0)
      graph.setPointRenderOrder(null)
      graph.render()
      expect(topPoint(graph)).toBe(3)
    } finally {
      destroy()
    }
  })

  it('applies an order set before the device is ready', async () => {
    const { graph, destroy } = createCanvasGraph()
    try {
      graph.setPointPositions(stackedPositions(4))
      graph.setPointRenderOrder([1])
      graph.render()
      await graph.ready
      expect(topPoint(graph)).toBe(1)
    } finally {
      destroy()
    }
  })

  it('keeps the order when the point count changes', async () => {
    const { graph, destroy } = createCanvasGraph()
    try {
      graph.setPointPositions(stackedPositions(4))
      graph.setPointRenderOrder([1])
      graph.render()
      await graph.ready
      graph.setPointPositions(stackedPositions(8))
      graph.render()
      expect(topPoint(graph)).toBe(1)
      graph.setPointPositions(stackedPositions(3))
      graph.render()
      expect(topPoint(graph)).toBe(1)
    } finally {
      destroy()
    }
  })

  it('applies an order set before a config change that rebuilds the graph', async () => {
    const { graph, destroy } = createCanvasGraph()
    try {
      graph.setPointPositions(stackedPositions(4))
      graph.render()
      await graph.ready
      graph.setPointRenderOrder([0])
      // A new space size rebuilds the graph before render() resolves the new order
      graph.setConfigPartial({ spaceSize: SPACE_SIZE * 2 })
      graph.render()
      expect(topPoint(graph)).toBe(0)
    } finally {
      destroy()
    }
  })

  it('draws a host pick pass by the order, so the host picks the point on top', async () => {
    const canvas = document.createElement('canvas')
    const device = await luma.createDevice({ type: 'webgl', adapters: [webgl2Adapter], createCanvasContext: { canvas } })
    // Four stacked points under a 200 × 200 target, one pixel per space unit: the pick
    // pass writes index + 1 into the red byte, and the point drawn last wins the pixel
    const graph = new Graph(null, {
      spaceSize: SPACE_SIZE,
      pixelRatio: 1,
      enableSimulation: false,
      rescalePositions: false,
      pointDefaultSize: 20,
    }, Promise.resolve(device))
    graph.setPointPositions(new Float32Array(4 * 2).fill(1000))
    graph.render()
    await graph.ready
    const target = device.createTexture({ format: 'rgba8unorm', width: 200, height: 200 })
    const framebuffer = device.createFramebuffer({ width: 200, height: 200, colorAttachments: [target] })
    const pickedAtCentre = (): number => {
      graph.render()
      const renderPass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0] })
      graph.drawToRenderPass(renderPass, { picking: { alpha: 1 } })
      renderPass.end()
      device.submit()
      const pixels = device.readPixelsToArrayWebGL(framebuffer) as Uint8Array
      return (pixels[(100 * 200 + 100) * 4] as number) - 1
    }
    try {
      // setViewTransform's formula, inverted for k = 1 and (1000, 1000) → (100, 100), with
      // the world origin at the centre of the space
      const ox = SPACE_SIZE / 2
      const oy = SPACE_SIZE / 2
      graph.setViewTransform({ k: 1, x: 100 - (1000 - ox + 200 / 2), y: 100 - (oy - 1000 + 200 / 2) }, [200, 200])
      expect(graph.spaceToScreenPosition([1000, 1000])).toEqual([100, 100])

      expect(pickedAtCentre()).toBe(3)
      graph.setPointRenderOrder([1])
      expect(pickedAtCentre()).toBe(1)
      graph.setPointRenderOrder(null)
      expect(pickedAtCentre()).toBe(3)

      // Highlighting layers the host pick like the visible draw: a highlighted point
      // wins over every greyed one, whatever the order; the order applies within a group
      graph.setConfigPartial({ highlightedPointIndices: [0, 2] })
      expect(pickedAtCentre()).toBe(2)
      graph.setPointRenderOrder([2, 1, 0, 3])
      expect(pickedAtCentre()).toBe(0)
      graph.setConfigPartial({ highlightedPointIndices: undefined })
      expect(pickedAtCentre()).toBe(3)
    } finally {
      graph.destroy()
      framebuffer.destroy()
      target.destroy()
      device.canvasContext?.destroy()
      device.destroy()
    }
  })
})
