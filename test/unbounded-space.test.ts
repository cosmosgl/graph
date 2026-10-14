import { describe, it, expect } from 'vitest'
import { luma, Texture, type Device } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { DataBounds } from '@/graph/modules/Shared/data-bounds'

/**
 * `spaceSize` sets the initial framing and bounds no position: graph size, not a
 * config constant, decides how large a layout gets. These tests pin the pieces that
 * make that true at a scale SwiftShader can run; the large-graph behaviour (hundreds
 * of thousands of points) is measured with the Space Size Wall story.
 */

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

const withCanvasGraph = async (
  config: GraphConfig,
  positions: Float32Array,
  run: (graph: Graph, div: HTMLDivElement) => Promise<void>
): Promise<void> => {
  const div = document.createElement('div')
  div.style.width = '400px'
  div.style.height = '300px'
  document.body.appendChild(div)
  const graph = new Graph(div, { fitViewOnInit: false, rescalePositions: false, ...config })
  graph.setPointPositions(positions, true)
  graph.render()
  await graph.ready
  try {
    await run(graph, div)
  } finally {
    graph.destroy()
    div.remove()
  }
}

describe('framing a layout larger than the space', () => {
  it('fitView frames a two-million-unit layout instead of stopping at a zoom floor', async () => {
    // A square 2e6 units wide in a 400×300 view at 10% padding fits at zoom
    // 300 · 0.8 / 2e6 = 1.2e-4 — below the 0.001 floor the zoom used to clamp
    // to, which left the fit over 8x too close with the layout's edges off screen.
    const span = 2e6
    const positions = new Float32Array([-span / 2, -span / 2, span / 2, span / 2, 0, 0])
    await withCanvasGraph({ enableSimulation: false }, positions, async (graph, div) => {
      graph.fitViewByPointPositions(Array.from(positions), 0, 0.1)
      // A zero-duration fit still lands through d3's transition timer
      for (let i = 0; i < 50 && graph.getZoomLevel() >= 0.001; i += 1) await wait(20)

      const w = div.clientWidth
      const h = div.clientHeight
      expect(graph.getZoomLevel()).toBeCloseTo((Math.min(w, h) * 0.8) / span, 12)
      // The height binds: the layout spans 80% of it, centred both ways
      const [left, top] = graph.spaceToScreenPosition([-span / 2, span / 2])
      const [right, bottom] = graph.spaceToScreenPosition([span / 2, -span / 2])
      expect(top).toBeCloseTo(h * 0.1, 6)
      expect(bottom).toBeCloseTo(h * 0.9, 6)
      expect(left).toBeCloseTo((w - h * 0.8) / 2, 6)
      expect(right).toBeCloseTo((w + h * 0.8) / 2, 6)
    })
  })
})

const createDevice = async (): Promise<Device> => luma.createDevice({
  type: 'webgl',
  adapters: [webgl2Adapter],
  createCanvasContext: { canvas: document.createElement('canvas') },
})

const destroyDevice = (device: Device): void => {
  device.canvasContext?.destroy()
  device.destroy()
}

const createFloatTexture = (device: Device, format: 'rgba32float' | 'rg32float', size: number, data: Float32Array): Texture => {
  const texture = device.createTexture({ width: size, height: size, format, usage: Texture.SAMPLE | Texture.COPY_DST })
  texture.copyImageData({ data, bytesPerRow: size * (format === 'rgba32float' ? 16 : 8), mipLevel: 0, x: 0, y: 0 })
  return texture
}

/** The box DataBounds must publish for these extremes: squared, fitted, floored, with the extent's reciprocal. */
const expectedBox = (lo: [number, number], hi: [number, number], minExtent: number): [number, number, number, number] => {
  const extent = Math.max(Math.max(hi[0] - lo[0], hi[1] - lo[1]), minExtent)
  return [(lo[0] + hi[0]) / 2 - extent / 2, (lo[1] + hi[1]) / 2 - extent / 2, extent, 1 / extent]
}

const expectBox = (actual: Float32Array, expected: [number, number, number, number]): void => {
  // float32 arithmetic in the shader vs float64 here
  for (let i = 0; i < 4; i += 1) {
    const e = expected[i] as number
    expect(Math.abs((actual[i] as number) - e)).toBeLessThanOrEqual(1e-5 * Math.max(i === 3 ? 0 : 1, Math.abs(e)))
  }
}

describe('data bounds (the box the many-body grid divides)', () => {
  // 40000 texels, 39000 points: more points than the 64² partial boxes (each one
  // strides through the list) and point indices past mediump int's 32767.
  const SIZE = 200
  const COUNT = 39000
  const MIN_EXTENT = 64

  const runBounds = (device: Device, positions: Float32Array, exit: Float32Array, exitSize: number, pointsNumber: number): Float32Array => {
    const positionsTexture = createFloatTexture(device, 'rgba32float', SIZE, positions)
    // The engine's exit texture: rg32float, G = absent (or its 1×1 all-present stand-in)
    const exitTexture = createFloatTexture(device, 'rg32float', exitSize, exit)
    const bounds = new DataBounds(device)
    try {
      bounds.run({ positionsTexture, exitTexture, pointsTextureSize: SIZE, pointsNumber, minExtent: MIN_EXTENT })
      expect(bounds.texture).toBeDefined()
      return device.readPixelsToArrayWebGL(bounds.texture as Texture) as Float32Array
    } finally {
      bounds.destroy()
      positionsTexture.destroy()
      exitTexture.destroy()
    }
  }

  /** Live points in [100, 300]×[400, 500], with planted extremes, absent and non-finite points, and garbage past the count. */
  const createPoints = (): { positions: Float32Array; exit: Float32Array } => {
    const positions = new Float32Array(SIZE * SIZE * 4)
    const exit = new Float32Array(SIZE * SIZE * 2)
    let seed = 7
    const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const set = (index: number, x: number, y: number): void => { positions[index * 4] = x; positions[index * 4 + 1] = y }
    for (let i = 0; i < COUNT; i += 1) set(i, 100 + random() * 200, 400 + random() * 100)
    // Texels past the point count hold leftovers, never points
    for (let i = COUNT; i < SIZE * SIZE; i += 1) set(i, -5000, -5000)
    // The extremes, two of them at indices past 32767
    set(38000, 50, 450)
    set(35000, 320, 450)
    set(100, 200, 380)
    set(5, 200, 510)
    // Absent points: a NaN one and one parked far away — neither is a live coordinate
    set(7, NaN, NaN)
    exit[7 * 2 + 1] = 1
    set(36000, 1e6, -1e6)
    exit[36000 * 2 + 1] = 1
    // Live but diverged: infinities and NaN must not set the box for everyone else
    set(9, Infinity, 450)
    set(33000, NaN, NaN)
    set(34000, 200, -Infinity)
    return { positions, exit }
  }

  it('squares and floors the box of the live, finite points', async () => {
    const device = await createDevice()
    try {
      const { positions, exit } = createPoints()
      const box = runBounds(device, positions, exit, SIZE, COUNT)
      // x spans 50..320 (270), y 380..510 (130): the square takes the larger side
      expectBox(box, expectedBox([50, 380], [320, 510], MIN_EXTENT))
    } finally {
      destroyDevice(device)
    }
  })

  it('floors a single point to minExtent around it, with the 1×1 all-present exit stand-in', async () => {
    const device = await createDevice()
    try {
      const { positions } = createPoints()
      positions[0] = 1234.5
      positions[1] = -987.25
      const box = runBounds(device, positions, new Float32Array(2), 1, 1)
      expectBox(box, expectedBox([1234.5, -987.25], [1234.5, -987.25], MIN_EXTENT))
    } finally {
      destroyDevice(device)
    }
  })

  it('degenerates to a valid minExtent box when every point is absent', async () => {
    const device = await createDevice()
    try {
      const { positions, exit } = createPoints()
      for (let i = 0; i < SIZE * SIZE; i += 1) exit[i * 2 + 1] = 1
      const box = runBounds(device, positions, exit, SIZE, COUNT)
      expectBox(box, expectedBox([0, 0], [0, 0], MIN_EXTENT))
    } finally {
      destroyDevice(device)
    }
  })
})

/**
 * Runs the many-body force alone (no gravity, no centering, no links) on a point
 * set, the way the space-wall harnesses do, and returns the positions.
 */
const runManyBody = async (positions: Float32Array, steps: number, onStep?: (graph: Graph, step: number) => void): Promise<Float32Array> => {
  const div = document.createElement('div')
  div.style.width = '400px'
  div.style.height = '300px'
  document.body.appendChild(div)
  const graph = new Graph(div, {
    spaceSize: 4096,
    enableRenderLoop: false,
    fitViewOnInit: false,
    rescalePositions: false,
    renderLinks: false,
    simulationGravity: 0,
    simulationCenter: 0,
    simulationDecay: 1e12,
    randomSeed: 5,
  })
  try {
    graph.setPointPositions(positions, true)
    graph.render(1, 0)
    await graph.ready
    graph.pause()
    for (let step = 1; step <= steps; step += 1) {
      graph.step()
      onStep?.(graph, step)
    }
    return graph.getPointPositionsArray()
  } finally {
    graph.destroy()
    div.remove()
  }
}

const extentOf = (positions: Float32Array): number => {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i] as number
    const y = positions[i + 1] as number
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return Math.max(maxX - minX, maxY - minY)
}

describe('the many-body grid follows the data', () => {
  // Above the 4096-point threshold, so the grid path runs instead of the exact all-pairs pass
  const COUNT = 5000

  it('lays out the same blob wherever it sits, to float rounding', async () => {
    // A 200-unit blob, 30 steps: it stays well inside the space at every centre,
    // so the position clamp never acts and only the grid's placement differs.
    let seed = 4242
    const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const blob = new Float64Array(COUNT * 2)
    for (let i = 0; i < COUNT; i += 1) {
      const angle = random() * 2 * Math.PI
      const radius = Math.sqrt(random()) * 200
      blob[i * 2] = Math.cos(angle) * radius
      blob[i * 2 + 1] = Math.sin(angle) * radius
    }
    const layoutAt = async (cx: number, cy: number): Promise<Float64Array> => {
      const positions = new Float32Array(COUNT * 2)
      for (let i = 0; i < COUNT; i += 1) {
        positions[i * 2] = cx + (blob[i * 2] as number)
        positions[i * 2 + 1] = cy + (blob[i * 2 + 1] as number)
      }
      const result = await runManyBody(positions, 30)
      const relative = new Float64Array(COUNT * 2)
      for (let i = 0; i < COUNT; i += 1) {
        relative[i * 2] = (result[i * 2] as number) - cx
        relative[i * 2 + 1] = (result[i * 2 + 1] as number) - cy
      }
      return relative
    }

    const reference = await layoutAt(1200, 1300)
    const referenceExtent = extentOf(new Float32Array(reference))
    for (const [cx, cy] of [[2900, 2750], [1203.37, 1301.71]] as const) {
      const moved = await layoutAt(cx, cy)
      let sumSquares = 0
      for (let i = 0; i < COUNT * 2; i += 1) sumSquares += ((moved[i] as number) - (reference[i] as number)) ** 2
      const rms = Math.sqrt(sumSquares / COUNT)
      // Measured on SwiftShader, as a fraction of the layout's extent: a grid
      // anchored to the space cut the blob at different cell boundaries per
      // offset — 3.0e-4 at (2900, 2750) and 9.9e-5 for the small nudge; the
      // data-anchored grid leaves only float rounding, 4.5e-6 and 1.4e-6.
      expect(rms / referenceExtent).toBeLessThan(2e-5)
    }
  })

  it('spreads a coincident stack: finite, bounded first kick, every point separated', async () => {
    // Every point on one coordinate: the data box has zero size, and only its
    // floor gives the grid usable cells.
    const positions = new Float32Array(COUNT * 2).fill(2048)
    let firstStepExtent = NaN
    const result = await runManyBody(positions, 10, (graph, step) => {
      if (step === 1) firstStepExtent = extentOf(graph.getPointPositionsArray())
    })

    // The near field's step bound is a fixed length — 2 × 4096 / 256 = 32 units
    // at this point count, before friction — not 2 × this tick's cell, which
    // the floored box makes a quarter unit: the first kick spreads the stack
    // tens of units, not a fraction of one.
    expect(firstStepExtent).toBeGreaterThan(16)
    expect(firstStepExtent).toBeLessThanOrEqual(64)

    let nonFinite = 0
    const distinct = new Set<string>()
    for (let i = 0; i < COUNT; i += 1) {
      const x = result[i * 2] as number
      const y = result[i * 2 + 1] as number
      if (!Number.isFinite(x) || !Number.isFinite(y)) nonFinite += 1
      distinct.add(`${x},${y}`)
    }
    expect(nonFinite).toBe(0)
    expect(distinct.size).toBe(COUNT)
    expect(extentOf(result)).toBeGreaterThan(firstStepExtent)
  })
})
