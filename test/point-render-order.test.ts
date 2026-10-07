import { describe, it, expect } from 'vitest'

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
})
