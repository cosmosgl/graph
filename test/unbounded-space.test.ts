import { describe, it, expect, vi } from 'vitest'
import { luma, Texture, type Device } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { Graph, defaultConfigValues, type GraphConfig } from '@cosmos.gl/graph'
import { DataBounds, getBucketGridSize, type DataBoundsRunOptions } from '@/graph/modules/Shared/data-bounds'
import { COARSEST_GRID_SIZE } from '@/graph/modules/ForceManyBody'
import { COLLISION_GRID_SIZE, COLLISION_ROTATIONS, collisionRotationSeed, withCollisionGrid } from '@/graph/modules/ForceCollision/collision-grid'

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

  const runBounds = (
    device: Device,
    positions: Float32Array,
    exit: Float32Array,
    exitSize: number,
    pointsNumber: number,
    originShift?: DataBoundsRunOptions['originShift']
  ): Float32Array => {
    const positionsTexture = createFloatTexture(device, 'rgba32float', SIZE, positions)
    // The engine's exit texture: rg32float, G = absent (or its 1×1 all-present stand-in)
    const exitTexture = createFloatTexture(device, 'rg32float', exitSize, exit)
    const bounds = new DataBounds(device)
    try {
      bounds.run({ positionsTexture, exitTexture, pointsTextureSize: SIZE, pointsNumber, minExtent: MIN_EXTENT, originShift })
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

  it('pads by one coarsest cell and slides the origin back by the given part of it, keeping the points inside', async () => {
    const device = await createDevice()
    try {
      const { positions, exit } = createPoints()
      const [fx, fy, fitted] = expectedBox([50, 380], [320, 510], MIN_EXTENT)
      const cellsPerAxis = 8
      const cell = fitted / (cellsPerAxis - 1)
      const extent = fitted + cell
      // Asymmetric offsets, so swapped axes or a misordered uniform fail; and both ends of the range
      for (const offset of [[0.25, 0.75], [0, 0.999999], [0.999999, 0]] as [number, number][]) {
        const box = runBounds(device, positions, exit, SIZE, COUNT, { cellsPerAxis, offset })
        expectBox(box, [fx - offset[0] * cell, fy - offset[1] * cell, extent, 1 / extent])
        // The live points' extremes stay inside whatever the offset
        const [ox, oy, side] = box as unknown as [number, number, number]
        expect(ox).toBeLessThanOrEqual(50)
        expect(ox + side).toBeGreaterThanOrEqual(320)
        expect(oy).toBeLessThanOrEqual(380)
        expect(oy + side).toBeGreaterThanOrEqual(510)
      }
    } finally {
      destroyDevice(device)
    }
  })
})

describe('data bounds across the bucket-grid threshold', () => {
  // 1,000,000 texels: enough for both tiers on one texture — 262,144 points run
  // 64² → 8² → 1, anything above runs 128² → 16² → 1.
  const SIZE = 1000
  const THRESHOLD = 262_144
  const MIN_EXTENT = 64

  type InternalTarget = { texture: Texture; fbo: { destroyed: boolean } }
  type Internals = { bucketsTarget?: InternalTarget; blocksTarget?: InternalTarget }
  const internals = (bounds: DataBounds): Internals => bounds as unknown as Internals

  /**
   * Live points inside [100, 300]×[400, 500] + `offset`, the box's extremes and
   * the absent and non-finite points planted below index 1000 — so every point
   * count from 1000 up publishes the same box — and garbage past `liveCount`.
   */
  const createPoints = (offset: [number, number], liveCount = SIZE * SIZE): { positions: Float32Array; exit: Float32Array } => {
    const positions = new Float32Array(SIZE * SIZE * 4)
    const exit = new Float32Array(SIZE * SIZE * 2)
    let seed = 11
    const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const set = (index: number, x: number, y: number): void => {
      positions[index * 4] = x + offset[0]
      positions[index * 4 + 1] = y + offset[1]
    }
    for (let i = 0; i < liveCount; i += 1) set(i, 101 + random() * 198, 401 + random() * 98)
    for (let i = liveCount; i < SIZE * SIZE; i += 1) set(i, -5000, -5000)
    set(900, 50, 450)
    set(901, 320, 450)
    set(902, 200, 380)
    set(903, 200, 510)
    set(7, NaN, NaN)
    exit[7 * 2 + 1] = 1
    set(8, 1e6, -1e6)
    exit[8 * 2 + 1] = 1
    positions[9 * 4] = Infinity
    positions[10 * 4] = NaN
    positions[10 * 4 + 1] = NaN
    positions[11 * 4 + 1] = -Infinity
    return { positions, exit }
  }

  const withTextures = async (
    data: { positions: Float32Array; exit: Float32Array },
    run: (device: Device, textures: { positionsTexture: Texture; exitTexture: Texture }) => void
  ): Promise<void> => {
    const device = await createDevice()
    const positionsTexture = createFloatTexture(device, 'rgba32float', SIZE, data.positions)
    const exitTexture = createFloatTexture(device, 'rg32float', SIZE, data.exit)
    try {
      run(device, { positionsTexture, exitTexture })
    } finally {
      positionsTexture.destroy()
      exitTexture.destroy()
      destroyDevice(device)
    }
  }

  it('sizes the first pass from the point count: 64² up to 262,144 points, 128² above', () => {
    for (const n of [1, 4096, 100_000, THRESHOLD - 1, THRESHOLD]) expect(getBucketGridSize(n)).toBe(64)
    for (const n of [THRESHOLD + 1, 300_000, 1_000_000, 1e8]) expect(getBucketGridSize(n)).toBe(128)
  })

  it('publishes the same box, bit for bit, on either side of the threshold', async () => {
    // min and max are exact, so the order the tiers fold the points in cannot
    // change the box. Two places — near the origin and a million units out —
    // with and without the origin shift.
    for (const offset of [[0, 0], [3e6, -2e6]] as [number, number][]) {
      await withTextures(createPoints(offset), (device, { positionsTexture, exitTexture }) => {
        for (const originShift of [undefined, { cellsPerAxis: 8, offset: [0.25, 0.75] as [number, number] }]) {
          const boxes = [THRESHOLD, THRESHOLD + 1, 600_000, SIZE * SIZE].map((pointsNumber) => {
            const bounds = new DataBounds(device)
            try {
              bounds.run({ positionsTexture, exitTexture, pointsTextureSize: SIZE, pointsNumber, minExtent: MIN_EXTENT, originShift })
              return Array.from(device.readPixelsToArrayWebGL(bounds.texture as Texture) as Float32Array)
            } finally {
              bounds.destroy()
            }
          })
          for (const box of boxes.slice(1)) expect(box).toEqual(boxes[0])
          if (!originShift) {
            const [ox, oy] = offset
            expectBox(new Float32Array(boxes[0] as number[]), expectedBox([50 + ox, 380 + oy], [320 + ox, 510 + oy], MIN_EXTENT))
          }
        }
      })
    }
  })

  it('skips the slots past the point count, and floors a coincident stack, on the 128² tier too', async () => {
    const liveCount = 999_000
    await withTextures(createPoints([0, 0], liveCount), (device, { positionsTexture, exitTexture }) => {
      const bounds = new DataBounds(device)
      try {
        bounds.run({ positionsTexture, exitTexture, pointsTextureSize: SIZE, pointsNumber: liveCount, minExtent: MIN_EXTENT })
        expect(internals(bounds).bucketsTarget?.texture.width).toBe(128)
        expectBox(device.readPixelsToArrayWebGL(bounds.texture as Texture) as Float32Array, expectedBox([50, 380], [320, 510], MIN_EXTENT))
      } finally {
        bounds.destroy()
      }
    })
    const stack = new Float32Array(SIZE * SIZE * 4)
    for (let i = 0; i < SIZE * SIZE; i += 1) { stack[i * 4] = 1234.5; stack[i * 4 + 1] = -987.25 }
    await withTextures({ positions: stack, exit: new Float32Array(SIZE * SIZE * 2) }, (device, { positionsTexture, exitTexture }) => {
      const boxes = [THRESHOLD, SIZE * SIZE].map((pointsNumber) => {
        const bounds = new DataBounds(device)
        try {
          bounds.run({ positionsTexture, exitTexture, pointsTextureSize: SIZE, pointsNumber, minExtent: MIN_EXTENT })
          return Array.from(device.readPixelsToArrayWebGL(bounds.texture as Texture) as Float32Array)
        } finally {
          bounds.destroy()
        }
      })
      expect(boxes[1]).toEqual(boxes[0])
      expectBox(new Float32Array(boxes[1] as number[]), expectedBox([1234.5, -987.25], [1234.5, -987.25], MIN_EXTENT))
    })
  })

  it('keeps the box texture through growth and shrink, reuses same-size targets and frees replaced ones', async () => {
    await withTextures(createPoints([0, 0]), (device, { positionsTexture, exitTexture }) => {
      const bounds = new DataBounds(device)
      const expected = expectedBox([50, 380], [320, 510], MIN_EXTENT)
      try {
        let boxTexture: Texture | undefined
        let previous: Internals = {}
        for (const pointsNumber of [1000, 300_000, 300_001, 1000, THRESHOLD, THRESHOLD + 1, SIZE * SIZE, 5000]) {
          bounds.run({ positionsTexture, exitTexture, pointsTextureSize: SIZE, pointsNumber, minExtent: MIN_EXTENT })
          const bucketGridSize = getBucketGridSize(pointsNumber)
          const current = { ...internals(bounds) }
          expect(current.bucketsTarget?.texture.width).toBe(bucketGridSize)
          expect(current.blocksTarget?.texture.width).toBe(bucketGridSize / 8)
          // Same tier: the same targets. A new tier: new targets, the old ones destroyed
          for (const key of ['bucketsTarget', 'blocksTarget'] as const) {
            const before = previous[key]
            if (!before) continue
            const resized = before.texture.width !== current[key]?.texture.width
            expect(current[key] === before).toBe(!resized)
            expect(before.texture.destroyed && before.fbo.destroyed).toBe(resized)
          }
          // The published texture is one object for the instance's whole life
          boxTexture ??= bounds.texture
          expect(bounds.texture).toBe(boxTexture)
          expectBox(device.readPixelsToArrayWebGL(bounds.texture as Texture) as Float32Array, expected)
          previous = current
        }
        const last = { ...internals(bounds) }
        bounds.destroy()
        expect(last.bucketsTarget?.texture.destroyed && last.blocksTarget?.texture.destroyed && boxTexture?.destroyed).toBe(true)
      } finally {
        bounds.destroy()
      }
    })
  })
})

/**
 * Runs the many-body force alone (no gravity, no centering, no links) on a point
 * set, the way the space-wall harnesses do, and returns the positions. `config`
 * overrides any of it.
 */
const runManyBody = async (
  positions: Float32Array,
  steps: number,
  onStep?: (graph: Graph, step: number) => void,
  config: GraphConfig = {}
): Promise<Float32Array> => {
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
    ...config,
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
    // A 200-unit blob, 30 steps, at centres inside the space: only the grid's
    // placement can differ (and, before the clamp went, nothing reached it).
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
    // the floored, padded box makes about 2/7 of a unit: the first kick spreads
    // the stack tens of units, not a fraction of one.
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

  it('shifts the grid every tick by less than one coarsest cell, always over every point', async () => {
    // A fixed grid keeps its cell boundaries on fixed lines, and the force jumps
    // at every boundary: dense layouts drew a cross along the box's centre lines.
    let seed = 777
    const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const positions = new Float32Array(COUNT * 2)
    for (let i = 0; i < COUNT; i += 1) {
      positions[i * 2] = 1000 + random() * 600
      positions[i * 2 + 1] = 2000 + random() * 300
    }
    // The positions the next step bins: with gravity and centering off, the
    // many-body pass is the step's first, so it reads what the last step wrote.
    let binned: Float32Array = positions
    const shifts: [number, number][] = []
    await runManyBody(positions, 8, (graph) => {
      const forceManyBody = (graph.simulation as unknown as { forceManyBody?: { dataBounds?: DataBounds } }).forceManyBody
      const texture = forceManyBody?.dataBounds?.texture
      expect(texture).toBeDefined()
      const box = graph.simulation.device?.readPixelsToArrayWebGL(texture as Texture) as Float32Array
      const [ox, oy, extent] = box as unknown as [number, number, number]
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (let i = 0; i < COUNT; i += 1) {
        const x = binned[i * 2] as number
        const y = binned[i * 2 + 1] as number
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      const fitted = Math.max(maxX - minX, maxY - minY)
      const cell = fitted / (COARSEST_GRID_SIZE - 1)
      // Padded by one coarsest cell…
      expect(Math.abs(extent - (fitted + cell))).toBeLessThanOrEqual(1e-5 * extent)
      // …over every point…
      expect(ox).toBeLessThanOrEqual(minX)
      expect(oy).toBeLessThanOrEqual(minY)
      expect(ox + extent).toBeGreaterThanOrEqual(maxX)
      expect(oy + extent).toBeGreaterThanOrEqual(maxY)
      // …slid back from the fitted square by less than that cell
      const u = ((minX + maxX) / 2 - fitted / 2 - ox) / cell
      const v = ((minY + maxY) / 2 - fitted / 2 - oy) / cell
      for (const shift of [u, v]) {
        expect(shift).toBeGreaterThan(-1e-3)
        expect(shift).toBeLessThan(1 + 1e-3)
      }
      shifts.push([u, v])
      binned = graph.getPointPositionsArray()
    })
    // Re-drawn every tick, and spread over the cell rather than stuck near one place
    expect(new Set(shifts.map(([u, v]) => `${u.toFixed(4)},${v.toFixed(4)}`)).size).toBe(shifts.length)
    const us = shifts.map(([u]) => u)
    expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(0.3)
  })
})

/**
 * Runs the collision force alone (no repulsion, gravity or centering) on a
 * point set and returns the positions.
 */
const runCollision = async (positions: Float32Array, steps: number, config: GraphConfig = {}): Promise<Float32Array> => {
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
    simulationRepulsion: 0,
    simulationGravity: 0,
    simulationCenter: 0,
    simulationCollision: 1,
    simulationDecay: 1e12,
    randomSeed: 9,
    pointDefaultSize: 12,
    ...config,
  })
  try {
    graph.setPointPositions(positions, true)
    graph.render(1, 0)
    await graph.ready
    graph.pause()
    for (let step = 0; step < steps; step += 1) graph.step()
    return graph.getPointPositionsArray()
  } finally {
    graph.destroy()
    div.remove()
  }
}

/** `count` points scattered over a `side`-unit square around the origin: an overlapping cluster to place anywhere. */
const createCluster = (count: number, side: number): Float64Array => {
  let seed = 808
  const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const cluster = new Float64Array(count * 2)
  for (let i = 0; i < count * 2; i += 1) cluster[i] = (random() - 0.5) * side
  return cluster
}

/** Copies of the cluster at each centre, back to back in one position array. */
const placeClusters = (cluster: Float64Array, centres: readonly (readonly [number, number])[]): Float32Array => {
  const count = cluster.length / 2
  const positions = new Float32Array(count * 2 * centres.length)
  centres.forEach(([cx, cy], c) => {
    for (let i = 0; i < count; i += 1) {
      positions[(c * count + i) * 2] = cx + (cluster[i * 2] as number)
      positions[(c * count + i) * 2 + 1] = cy + (cluster[i * 2 + 1] as number)
    }
  })
  return positions
}

/** Pairs of points in `positions[from..to)` closer than `distance`. */
const countPairsCloserThan = (positions: Float32Array, from: number, to: number, distance: number): number => {
  let pairs = 0
  for (let i = from; i < to; i += 1) {
    for (let j = i + 1; j < to; j += 1) {
      const dx = (positions[i * 2] as number) - (positions[j * 2] as number)
      const dy = (positions[i * 2 + 1] as number) - (positions[j * 2 + 1] as number)
      if (Math.hypot(dx, dy) < distance) pairs += 1
    }
  }
  return pairs
}

describe('the collision hash follows the data', () => {
  it('resolves the same overlapping cluster wherever it sits, to float rounding', async () => {
    // Compare one constraint pass: repeated pairwise projections amplify the
    // initial float32 rounding differences at translated world coordinates.
    // The data-relative mapping must not change the initial collision response.
    const COUNT = 800
    const cluster = createCluster(COUNT, 120)
    const layoutAt = async (cx: number, cy: number): Promise<Float64Array> => {
      const result = await runCollision(placeClusters(cluster, [[cx, cy]]), 1)
      const relative = new Float64Array(COUNT * 2)
      for (let i = 0; i < COUNT; i += 1) {
        relative[i * 2] = (result[i * 2] as number) - cx
        relative[i * 2 + 1] = (result[i * 2 + 1] as number) - cy
      }
      return relative
    }

    const reference = await layoutAt(2048, 2048)
    const referenceExtent = extentOf(new Float32Array(reference))
    for (const [cx, cy] of [[1000, 3100], [2900.37, 1500.71]] as const) {
      const moved = await layoutAt(cx, cy)
      let sumSquares = 0
      for (let i = 0; i < COUNT * 2; i += 1) sumSquares += ((moved[i] as number) - (reference[i] as number)) ** 2
      const rms = Math.sqrt(sumSquares / COUNT)
      expect(rms / referenceExtent).toBeLessThan(1e-3)
    }
  })

  it('keeps the cell at the contact range for a large collision radius', async () => {
    // A 60-unit contact range: the cell is 60 units however small the cluster
    // is. A cell fitted to the cluster instead — its extent / 512, a fraction
    // of a unit — leaves the 3×3 scan reaching almost none of the overlapping
    // points (measured: the cluster never spreads, every one of its 1962
    // overlapping pairs is still there after the 400 steps).
    const COUNT = 100
    const result = await runCollision(placeClusters(createCluster(COUNT, 120), [[2048, 2048]]), 400, { simulationCollisionRadius: 30 })
    // From 1962 overlapping pairs (of 4950), every contact is resolved by
    // step 300 — with the space-anchored hash as with this one.
    expect(countPairsCloserThan(result, 0, COUNT, 0.9 * 60)).toBe(0)
    expect(extentOf(result)).toBeGreaterThan(600)
  })

  it('keeps the contact-range cell across a layout hundreds of contact ranges wide', async () => {
    // Three copies of a cluster across an 8000-unit space: a layout ~7600
    // units wide, 633 contact ranges at size 12 — within the 1,020 the hash
    // keeps in its unrotated middle block, so every copy bins as on a plain
    // grid of 12-unit cells. The space-anchored hash, capped at 512 cells over
    // the space, had 15.6-unit cells; a cell widened to fit 512 over the
    // layout would be ~14.8. Either spreads every copy less. (A layout wide
    // enough to share texels: the 200,000-unit outlier test below.)
    const COUNT = 400
    const centres = [[300, 300], [4000, 4000], [7700, 7700]] as const
    const result = await runCollision(placeClusters(createCluster(COUNT, 120), centres), 100, { spaceSize: 8000 })
    const extents = centres.map((_, c) => extentOf(result.subarray(c * COUNT * 2, (c + 1) * COUNT * 2)))
    // Measured on SwiftShader (from ~120): 188.0, 185.8 and 191.9; with the
    // widened cell 171.5, 168.4 and 169.0; with the space-anchored hash 163.7,
    // 166.5 and 161.5.
    for (const extent of extents) expect(extent).toBeGreaterThan(180)
    expect(Math.max(...extents) / Math.min(...extents)).toBeLessThan(1.1)
  })

  it('spreads a stack of points from the first step, off the centre of the layout too', async () => {
    // 200 points at one position, 2,050 units from the centre of the data box
    // (one more point fixes it). All of them read the same texel, and its sum
    // is rounded: the average of the other 199 lands a few hundredths of a
    // unit off the stack — the same direction for every one of them, so a
    // 0.001-unit coincidence test sent the stack off as a block instead of
    // spreading it. Measured with that test: still one stack after the first
    // step on Metal and SwiftShader, after ten on Metal. Within the sum's
    // rounding error the points count as coincident and spread by index.
    const COUNT = 200
    const positions = new Float32Array(COUNT * 2 + 2)
    for (let i = 0; i < COUNT; i += 1) positions.set([3000.37, 1000.37], i * 2)
    positions.set([100, 3900], COUNT * 2)
    const result = await runCollision(positions, 1, { pointDefaultSize: 8 })
    const stack = result.subarray(0, COUNT * 2)
    // Measured: 2.72 units wide after the step, every point apart
    expect(extentOf(stack)).toBeGreaterThan(2)
    const distinct = new Set(Array.from({ length: COUNT }, (_, i) => `${stack[i * 2]},${stack[i * 2 + 1]}`))
    expect(distinct.size).toBe(COUNT)
  })

  it('resolves a dense cluster the same with one point far away', async () => {
    // One point 7400 units from the cluster: a data box ~620 contact ranges
    // wide. The cell stays the contact range (12) and that point lands on
    // texels of its own. A cell sized to fit a fixed count over the box
    // weakens collision for the whole cluster.
    const COUNT = 800
    const positions = new Float32Array(COUNT * 2 + 2)
    positions.set(placeClusters(createCluster(COUNT, 120), [[500, 500]]))
    positions.set([7900, 7900], COUNT * 2)
    const result = await runCollision(positions, 100, { spaceSize: 8000 })
    // Measured on SwiftShader: extent 210.5 with 4026 overlapping pairs — the
    // cluster alone gives 212.6 and 4070. A cell widened to fit 512 over the
    // box (~14.8) gave 179.8 and 5639; the space-anchored hash (cell 15.6)
    // 166.5 and 6872.
    expect(extentOf(result.subarray(0, COUNT * 2))).toBeGreaterThan(195)
    expect(countPairsCloserThan(result, 0, COUNT, 0.9 * 12)).toBeLessThan(4600)
  })
})

describe('the collision hash bins in both programs alike (collision-grid.ts)', () => {
  it('moves no isolated point planted on a cell boundary, through the engine\'s own programs', async () => {
    // The agreement below, end to end: build-grid.vert and
    // force-collision-spatial.frag as the engine compiles them, uniform blocks
    // and all. An isolated point feels no collision — unless the force pass
    // puts it in another cell than the one the build pass binned it into: then
    // it finds itself in a neighbouring texel, at distance zero, and is pushed
    // off. Two corner points fix the data box (centre 2048, floored to the
    // grid's 8192-unit width), so its origin is exactly -2048, and every other
    // point sits within 3 ULPs of a half-cell boundary — a cell boundary on
    // two of the four offset lattices — eight cells from its neighbours.
    const CELL = 8
    const ORIGIN = 2048 - (CELL * COLLISION_GRID_SIZE) / 2
    let seed = 7
    const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const bits = new Float32Array(1)
    const ulps = new Int32Array(bits.buffer)
    const plant = (cell: number): number => {
      bits[0] = ORIGIN + (2 * cell + Math.floor(random() * 5) - 2) * (CELL / 2)
      ulps[0] = (ulps[0] as number) + Math.floor(random() * 7) - 3
      return bits[0] as number
    }
    const coordinates = [48, 48, 4048, 4048]
    for (let cellX = 270; cellX <= 755; cellX += 8) {
      for (let cellY = 270; cellY <= 755; cellY += 8) coordinates.push(plant(cellX), plant(cellY))
    }
    const positions = new Float32Array(coordinates)
    const result = await runCollision(positions, 1, { pointDefaultSize: CELL })
    let moved = 0
    for (let i = 0; i < positions.length; i += 1) if (result[i] !== positions[i]) moved += 1
    // Measured, with the force pass alone scaling by 1.000001 more than the
    // build pass: 1,528 of the 3,723 points moved, on Metal and SwiftShader
    // alike. (Inside the space every cell lies in the origin's block, which
    // the hash leaves unrotated: the rotation is pinned by the next test.)
    expect(moved).toBe(0)
  })

  it('puts every position in the same cell and texel in the vertex and the fragment program', () => {
    // The build pass (a vertex program) bins each point and the force pass (a
    // fragment program) recomputes the cell of the point it shades: they must
    // agree, or a point subtracts itself from a cell it is not in. Positions
    // are planted within 2 ULPs of half-cell boundaries — where a division, or
    // a shift fused into a multiply-add in one program only, would split them
    // — over cells -1500..2600 from the data origin, five blocks of the
    // 1024-texel grid per axis, on all four offset lattices. The texels are
    // checked against the block rotation run in JavaScript, and in the
    // fragment program for the cell diagonally before — the 3×3 scan's
    // neighbour, often in another block.
    const SIZE = 64
    const COUNT = SIZE * SIZE
    const GRID = COLLISION_GRID_SIZE
    const f = Math.fround
    const origin = [f(-20000.3), f(19000.7)] as const
    const cellSize = 12
    const cellsPerUnit = f(1 / cellSize)
    // A tick past the first, whose seed is not zero
    const rotationSeed = collisionRotationSeed(3)

    const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext
    expect(gl.getExtension('EXT_color_buffer_float')).not.toBeNull()
    const compile = (vs: string, fs: string): WebGLProgram => {
      const program = gl.createProgram() as WebGLProgram
      for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
        const shader = gl.createShader(type) as WebGLShader
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(String(gl.getShaderInfoLog(shader)))
        gl.attachShader(program, shader)
      }
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(String(gl.getProgramInfoLog(program)))
      return program
    }
    const floatTexture = (width: number, height: number, data: Float32Array | null): WebGLTexture => {
      const texture = gl.createTexture() as WebGLTexture
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data)
      return texture
    }

    const header = `#version 300 es
precision highp float;
uniform highp sampler2D positionsTexture;
uniform vec2 gridOffset;
uniform float cellsPerUnit;
uniform float rotationSeed;
// @collision-grid
`
    // Vertex program: [cell, its texel], one point per output texel.
    const vertexBinning = compile(withCollisionGrid(`${header}
flat out vec4 binned;
void main() {
  ivec2 texel = ivec2(gl_VertexID % ${SIZE}, gl_VertexID / ${SIZE});
  highp ivec2 cell = collisionCell(texelFetch(positionsTexture, texel, 0).xy, gridOffset, cellsPerUnit);
  binned = vec4(vec2(cell), vec2(collisionTexel(cell, gridOffset, rotationSeed)));
  gl_Position = vec4(2.0 * (vec2(texel) + 0.5) / ${SIZE}.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`), '#version 300 es\nprecision highp float;\nflat in vec4 binned;\nout vec4 color;\nvoid main() { color = binned; }')
    // Fragment program: [cell, the texel of the cell before it] — the 3×3
    // scan's wrapped neighbour.
    const fragmentBinning = compile('#version 300 es\nin vec2 corner;\nvoid main() { gl_Position = vec4(corner, 0.0, 1.0); }', withCollisionGrid(`${header}
out vec4 color;
void main() {
  highp ivec2 cell = collisionCell(texelFetch(positionsTexture, ivec2(gl_FragCoord.xy), 0).xy, gridOffset, cellsPerUnit);
  color = vec4(vec2(cell), vec2(collisionTexel(cell + ivec2(-1), gridOffset, rotationSeed)));
}`))

    let seed = 31
    const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const bits = new Float32Array(1)
    const ulps = new Int32Array(bits.buffer)
    const positions = new Float32Array(COUNT * 4)
    for (let i = 0; i < COUNT; i += 1) {
      for (let axis = 0; axis < 2; axis += 1) {
        const halfCell = Math.floor(random() * 8200) - 3000
        bits[0] = (origin[axis] as number) + halfCell * (cellSize / 2)
        ulps[0] = (ulps[0] as number) + Math.floor(random() * 5) - 2
        positions[i * 4 + axis] = bits[0] as number
      }
    }
    const positionsTexture = floatTexture(SIZE, SIZE, positions)
    const boundsTexture = floatTexture(1, 1, new Float32Array([origin[0], origin[1], 1, 1]))
    const outputTexture = floatTexture(SIZE, SIZE, null)
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0)
    gl.viewport(0, 0, SIZE, SIZE)
    const corners = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, corners)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

    const run = (program: WebGLProgram, shift: readonly [number, number], draw: () => void): Float32Array => {
      gl.useProgram(program)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, positionsTexture)
      gl.uniform1i(gl.getUniformLocation(program, 'positionsTexture'), 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, boundsTexture)
      gl.uniform1i(gl.getUniformLocation(program, 'dataBoundsTexture'), 1)
      gl.uniform2f(gl.getUniformLocation(program, 'gridOffset'), shift[0], shift[1])
      gl.uniform1f(gl.getUniformLocation(program, 'cellsPerUnit'), cellsPerUnit)
      gl.uniform1f(gl.getUniformLocation(program, 'rotationSeed'), rotationSeed)
      gl.clearColor(0.5, 0.5, 0.5, 0.5)
      gl.clear(gl.COLOR_BUFFER_BIT)
      draw()
      const pixels = new Float32Array(COUNT * 4)
      gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.FLOAT, pixels)
      return pixels
    }

    // Strict float32: the half cell is floor((p - o) · (2 / cellSize)), a cell two half cells.
    const expectedCell = (p: number, axis: number, shift: number): number =>
      Math.floor((Math.floor(f(f(p - (origin[axis] as number)) * f(2 * cellsPerUnit))) + 2 * shift) / 2)
    // A block's rotation, r(k) = a·k² + (b + seed)·k modulo the grid, in 32-bit
    // integer arithmetic as GLSL ES defines highp uint; each axis takes its
    // rotation from the block along the other one.
    const rotation = (block: number, [a, b]: readonly [number, number]): number =>
      (Math.imul(Math.imul(a, block), block) + Math.imul(b + rotationSeed, block)) & (GRID - 1)
    const texelOf = (cellX: number, cellY: number, shift: readonly [number, number]): readonly [number, number] => {
      const lattice = shift[0] * 2 + 2 * (shift[1] * 2)
      const rotationX = rotation(Math.floor(cellY / GRID), COLLISION_ROTATIONS[lattice] as readonly [number, number])
      const rotationY = rotation(Math.floor(cellX / GRID), COLLISION_ROTATIONS[3 - lattice] as readonly [number, number])
      return [(cellX + rotationX) & (GRID - 1), (cellY + rotationY) & (GRID - 1)]
    }

    try {
      for (const shift of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]] as const) {
        const fromVertex = run(vertexBinning, shift, () => gl.drawArrays(gl.POINTS, 0, COUNT))
        const fromFragment = run(fragmentBinning, shift, () => {
          const location = gl.getAttribLocation(fragmentBinning, 'corner')
          gl.enableVertexAttribArray(location)
          gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
          gl.disableVertexAttribArray(location)
        })
        let disagreements = 0
        let lowest = Infinity
        let highest = -Infinity
        let rotated = 0
        for (let i = 0; i < COUNT; i += 1) {
          const cell = [0, 1].map((axis) => expectedCell(positions[i * 4 + axis] as number, axis, shift[axis] as number)) as [number, number]
          const texel = texelOf(cell[0], cell[1], shift)
          const neighbour = texelOf(cell[0] - 1, cell[1] - 1, shift)
          for (let axis = 0; axis < 2; axis += 1) {
            lowest = Math.min(lowest, cell[axis] as number)
            highest = Math.max(highest, cell[axis] as number)
            if (fromVertex[i * 4 + axis] !== cell[axis] || fromFragment[i * 4 + axis] !== cell[axis]) disagreements += 1
            if (fromVertex[i * 4 + 2 + axis] !== texel[axis] || fromFragment[i * 4 + 2 + axis] !== neighbour[axis]) disagreements += 1
          }
          const [blockX, blockY] = [Math.floor(cell[0] / GRID), Math.floor(cell[1] / GRID)]
          if (blockX !== 0 || blockY !== 0) rotated += 1
        }
        expect(disagreements).toBe(0)
        // Both ends of the grid were crossed, and most cells lie outside the
        // origin's block, where their texels are rotated
        expect(lowest).toBeLessThan(-1000)
        expect(highest).toBeGreaterThan(2 * GRID)
        expect(rotated).toBeGreaterThan(COUNT / 2)
      }
    } finally {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  })
})

describe('positions are not bounded by the space', () => {
  // Every force off: nothing moves a point but the test
  const STILL: GraphConfig = {
    spaceSize: 4096,
    enableRenderLoop: false,
    simulationGravity: 0,
    simulationCenter: 0,
    simulationRepulsion: 0,
    simulationDecay: 1e12,
    randomSeed: 3,
  }

  it('keeps a point where it was put, outside the space, through the simulation', async () => {
    // The position clamp moved these onto the border at the first step: to
    // (0, 4096) and (4096, 0).
    const positions = new Float32Array([-5000, 9000, 20000, -300, 2048, 2048])
    await withCanvasGraph(STILL, positions, async (graph) => {
      graph.pause()
      for (let step = 0; step < 20; step += 1) graph.step()
      expect(Array.from(graph.getPointPositionsArray())).toEqual(Array.from(positions))
      // And a host can move one out there
      graph.setPointPosition(2, -12345.5, 54321.25)
      for (let step = 0; step < 20; step += 1) graph.step()
      expect(Array.from(graph.getPointPositionsArray())).toEqual([-5000, 9000, 20000, -300, -12345.5, 54321.25])
    })
  })

  it('lets a layout larger than the space grow past it', async () => {
    // 5000 points (the grid path) in a 100-unit blob at the centre of a
    // 512-unit space, gravity off: repulsion has nothing to balance it.
    const COUNT = 5000
    const SPACE = 512
    let seed = 4242
    const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const positions = new Float32Array(COUNT * 2)
    for (let i = 0; i < COUNT; i += 1) {
      const angle = random() * 2 * Math.PI
      const radius = Math.sqrt(random()) * 100
      positions[i * 2] = SPACE / 2 + Math.cos(angle) * radius
      positions[i * 2 + 1] = SPACE / 2 + Math.sin(angle) * radius
    }
    const result = await runManyBody(positions, 50, undefined, { spaceSize: SPACE })
    let beyond = 0
    let nonFinite = 0
    for (let i = 0; i < COUNT; i += 1) {
      const x = result[i * 2] as number
      const y = result[i * 2 + 1] as number
      if (!Number.isFinite(x) || !Number.isFinite(y)) nonFinite += 1
      else if (x < 0 || x > SPACE || y < 0 || y > SPACE) beyond += 1
    }
    // Measured on SwiftShader: extent 1322 with 4059 points beyond the space.
    // With the position clamp, 512 — the space — and none beyond it.
    expect(nonFinite).toBe(0)
    expect(extentOf(result)).toBeGreaterThan(2 * SPACE)
    expect(beyond).toBeGreaterThan(COUNT / 2)
  })

  it('takes a spaceSize above the device\'s texture limit as it is: the world origin is spaceSize / 2', async () => {
    // A spaceSize at or above the texture size limit used to be halved — down
    // to half the limit — which moved the world origin and the initial view
    // away from where the config put them.
    const warn = vi.spyOn(console, 'warn')
    try {
      const SPACE = 100000
      await withCanvasGraph({ spaceSize: SPACE, enableSimulation: false }, new Float32Array([0, 0]), async (graph, div) => {
        const limit = graph.simulation.device?.limits.maxTextureDimension2D ?? 0
        expect(limit).toBeGreaterThan(0)
        const centreOfScreen = (spaceSize: number): void => {
          graph.setViewTransform({ k: 1, x: 0, y: 0 })
          const [x, y] = graph.spaceToScreenPosition([spaceSize / 2, spaceSize / 2])
          expect(x).toBeCloseTo(div.clientWidth / 2, 6)
          expect(y).toBeCloseTo(div.clientHeight / 2, 6)
        }
        // Set at creation, and changed on a live graph
        expect(SPACE).toBeGreaterThan(limit)
        centreOfScreen(SPACE)
        graph.setConfigPartial({ spaceSize: 3 * limit })
        centreOfScreen(3 * limit)
      })
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('spaceSize'))
    } finally {
      warn.mockRestore()
    }
  })

  it('warns about a spaceSize whose world origin is past float32\'s fine range, and uses it as given', async () => {
    // A layout settles around the world origin, spaceSize / 2. Past 2^21 that origin is past
    // ~1e6, where float32 positions get too coarse for the forces: warned about, not reduced
    const warn = vi.spyOn(console, 'warn')
    try {
      const SPACE = 2 ** 22
      await withCanvasGraph({ spaceSize: SPACE, enableSimulation: false }, new Float32Array([0, 0]), async (graph, div) => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('spaceSize (4194304)'))
        graph.setViewTransform({ k: 1, x: 0, y: 0 })
        const [x, y] = graph.spaceToScreenPosition([SPACE / 2, SPACE / 2])
        expect(x).toBeCloseTo(div.clientWidth / 2, 6)
        expect(y).toBeCloseTo(div.clientHeight / 2, 6)
        // The largest one that does not warn
        warn.mockClear()
        graph.setConfigPartial({ spaceSize: 2 ** 21 })
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('spaceSize'))
      })
    } finally {
      warn.mockRestore()
    }
  })
})

describe('the step bound (update-position.frag)', () => {
  it('drops a non-finite step and shortens a long one to maxStep, along its direction', async () => {
    // Velocities written straight into the velocity texture, then one position
    // update. friction 1: the step is the velocity. maxStep is the space, 4096.
    const MAX_STEP = 4096
    const velocities: readonly (readonly [number, number])[] = [
      [NaN, 0], [0, NaN], [NaN, NaN], [Infinity, 0], [-Infinity, 5], [Infinity, -Infinity],
      // Finite but huge: its length, and the reciprocal of 3e38, are past float32's range
      [1e10, 0], [-1e20, 2e20], [2e19, 2e19], [3e38, 3e38], [3e38, -1],
      // Within the bound, the bound itself, and just over it
      [100, -50], [MAX_STEP, 0], [2890, 2890], [2900, 2900],
    ]
    const count = velocities.length
    const positions = new Float32Array(count * 2)
    for (let i = 0; i < count; i += 1) positions.set([1000 + i * 10, -3000 + i * 7], i * 2)
    await withCanvasGraph({ spaceSize: 4096, simulationFriction: 1, enableRenderLoop: false }, positions, async (graph) => {
      graph.pause()
      const points = graph.simulation.points
      const size = graph.simulation.store.pointsTextureSize
      expect(points?.velocityTexture).toBeDefined()
      const velocity = new Float32Array(size * size * 4)
      velocities.forEach(([x, y], i) => velocity.set([x, y], i * 4))
      points?.velocityTexture?.copyImageData({ data: velocity, bytesPerRow: size * 16, mipLevel: 0, x: 0, y: 0 })
      const before = graph.getPointPositionsArray()
      points?.updatePosition()
      const after = graph.getPointPositionsArray()

      velocities.forEach(([vx, vy], i) => {
        const x = after[i * 2] as number
        const y = after[i * 2 + 1] as number
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
          // Not a step at all: the point stays exactly where it was
          expect([x, y]).toEqual([before[i * 2], before[i * 2 + 1]])
          return
        }
        const length = Math.hypot(vx, vy)
        const scale = length > MAX_STEP ? MAX_STEP / length : 1
        // float32 positions in the thousands: a few thousandths of a unit
        expect(x - (before[i * 2] as number)).toBeCloseTo(vx * scale, 2)
        expect(y - (before[i * 2 + 1] as number)).toBeCloseTo(vy * scale, 2)
      })
    })
  })
})

describe('an infinite input coordinate', () => {
  // A present point with an infinite coordinate (only NaN marks a point
  // absent). The clamp used to catch it — sometimes. Without it, its first step
  // is non-finite and its position stays infinite, and the many-body pass sums
  // it with the others: every point's force turns NaN at the first step.
  for (const [path, count] of [['all-pairs', 800], ['grid', 5000]] as const) {
    it(`lands on the edge of the space and leaves every point finite (${path} path)`, async () => {
      let seed = 808
      const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
      const positions = new Float32Array(count * 2)
      for (let i = 0; i < count * 2; i += 1) positions[i] = 2048 + (random() - 0.5) * 600
      positions.set([Infinity, 2000], 0)
      positions.set([1500, -Infinity], 2)
      let firstStep: number[] = []
      // Default forces, gravity included
      const result = await runManyBody(positions, 10, (graph, step) => {
        if (step === 1) firstStep = Array.from(graph.getPointPositionsArray().subarray(0, 4))
      }, { simulationGravity: 0.25 })
      // Measured on SwiftShader with the clamp deleted and nothing else: every
      // other point NaN from the first step, on both paths.
      let nonFinite = 0
      for (let i = 0; i < count * 2; i += 1) if (!Number.isFinite(result[i] as number)) nonFinite += 1
      expect(nonFinite).toBe(0)
      // After one step, near the edge it was placed on — (4096, 2000) and
      // (1500, 0) — not at the old clamp's (0, 0)
      expect(firstStep[0]).toBeGreaterThan(3000)
      expect(firstStep[1]).toBeCloseTo(2000, -2)
      expect(firstStep[3]).toBeLessThan(1000)
      // The input is not modified
      expect(positions[0]).toBe(Infinity)
      expect(extentOf(result.subarray(4))).toBeGreaterThan(500)
    })
  }

  it('lands on the edge from setPointPosition too, and a NaN target is ignored', async () => {
    const config: GraphConfig = { spaceSize: 4096, enableRenderLoop: false, simulationGravity: 0, simulationRepulsion: 0 }
    await withCanvasGraph(config, new Float32Array([100, 200, 300, 400]), async (graph) => {
      graph.pause()
      graph.setPointPosition(0, -Infinity, 1e39) // 1e39 is past float32: Infinity
      graph.setPointPosition(1, NaN, 5)
      expect(Array.from(graph.getPointPositionsArray())).toEqual([0, 4096, 300, 400])
    })
  })
})

describe('a non-finite simulationFriction', () => {
  it('runs at the default friction instead of turning every position non-finite', async () => {
    // update-position drops a non-finite velocity, but friction is applied after that test:
    // a NaN friction made every step NaN, and an infinite one made a resting point's
    // 0 × Infinity = NaN — the graph vanished for good.
    let seed = 515
    const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const positions = new Float32Array(800 * 2)
    for (let i = 0; i < positions.length; i += 1) positions[i] = 2048 + (random() - 0.5) * 400
    const run = (simulationFriction: number): Promise<Float32Array> =>
      runManyBody(positions, 20, undefined, { simulationGravity: 0.25, simulationFriction })
    const reference = Array.from(await run(defaultConfigValues.simulationFriction))
    expect(reference.every(Number.isFinite)).toBe(true)
    for (const friction of [NaN, Infinity, -Infinity]) {
      expect(Array.from(await run(friction))).toEqual(reference)
    }
  })
})

describe('custom cluster positions', () => {
  it('pulls a cluster to any finite position, negative coordinates included; a non-finite one means its centre of mass', async () => {
    // A negative coordinate used to mean "no custom position": with positions in [0, spaceSize]
    // it could never be a place. Clusters 0 and 1 go to positions with a negative coordinate,
    // cluster 2 has none, and cluster 3 a NaN one: those two keep to their centres of mass.
    const CLUSTERS = 4
    const COUNT = 400
    let seed = 99
    const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const positions = new Float32Array(COUNT * 2)
    for (let i = 0; i < positions.length; i += 1) positions[i] = 2048 + (random() - 0.5) * 200
    const div = document.createElement('div')
    div.style.width = '400px'
    div.style.height = '300px'
    document.body.appendChild(div)
    const graph = new Graph(div, {
      spaceSize: 4096,
      enableRenderLoop: false,
      fitViewOnInit: false,
      rescalePositions: false,
      simulationGravity: 0,
      simulationCenter: 0,
      simulationRepulsion: 0,
      simulationCluster: 1,
      simulationDecay: 1e12,
      randomSeed: 7,
    })
    try {
      graph.setPointPositions(positions, true)
      graph.setPointClusters(Array.from({ length: COUNT }, (_, i) => i % CLUSTERS))
      graph.setClusterPositions([-3000, 2048, 2048, -5000, undefined, undefined, NaN, 100])
      graph.render(1, 0)
      await graph.ready
      graph.pause()
      for (let step = 0; step < 100; step += 1) graph.step()
      const result = graph.getPointPositionsArray()
      const centroids = Array.from({ length: CLUSTERS }, (_, cluster) => {
        let x = 0
        let y = 0
        for (let i = cluster; i < COUNT; i += CLUSTERS) {
          x += result[i * 2] as number
          y += result[i * 2 + 1] as number
        }
        return [x / (COUNT / CLUSTERS), y / (COUNT / CLUSTERS)]
      })
      expect(centroids[0]![0]).toBeCloseTo(-3000, 0)
      expect(centroids[0]![1]).toBeCloseTo(2048, 0)
      expect(centroids[1]![0]).toBeCloseTo(2048, 0)
      expect(centroids[1]![1]).toBeCloseTo(-5000, 0)
      for (const cluster of [2, 3]) {
        expect(Math.abs(centroids[cluster]![0]! - 2048)).toBeLessThan(30)
        expect(Math.abs(centroids[cluster]![1]! - 2048)).toBeLessThan(30)
      }
    } finally {
      graph.destroy()
      div.remove()
    }
  })
})

describe('collision away from the space', () => {
  it('resolves slot-path contacts outside the space with a distant outlier', async () => {
    const pairs = 2500 // 5001 points: above the all-pairs threshold
    const positions = new Float32Array((pairs * 2 + 1) * 2)
    for (let pair = 0; pair < pairs; pair += 1) {
      const x = 20000 + (pair % 50) * 40
      const y = -9000 + Math.floor(pair / 50) * 40
      positions.set([x, y, x + 1, y], pair * 4)
    }
    positions.set([220000, -9000], pairs * 4)
    const result = await runCollision(positions, 2, { pointDefaultSize: 8 })
    for (let pair = 0; pair < pairs; pair += 1) {
      const offset = pair * 4
      expect(Math.hypot(
        (result[offset] as number) - (result[offset + 2] as number),
        (result[offset + 1] as number) - (result[offset + 3] as number)
      )).toBeGreaterThan(7.9)
    }
    expect(Array.from(result.subarray(pairs * 4))).toEqual([220000, -9000])
  })

  it('spreads an overlapping cluster far outside the space as it does inside it', async () => {
    const COUNT = 800
    const cluster = createCluster(COUNT, 120)
    const extentAt = async (centre: readonly [number, number]): Promise<number> =>
      extentOf(await runCollision(placeClusters(cluster, [centre]), 100))
    const inside = await extentAt([2048, 2048])
    // Measured on SwiftShader from 120 units: 211.8 inside, 209.9 at 20,000 and
    // 213.6 at -9,000. With the position clamp the far clusters collapsed into a
    // corner of the space (11.2); without it, a hash anchored at world zero left
    // them at 119.7 — collision did nothing outside the space.
    expect(inside).toBeGreaterThan(200)
    for (const centre of [[20000, 20000], [-9000, -9000]] as const) {
      expect(Math.abs((await extentAt(centre)) / inside - 1)).toBeLessThan(0.05)
    }
  })

  it('resolves a cluster the same with one point 200,000 units away', async () => {
    // A data box 200,000 units wide: ~16,700 contact ranges, 16 times the
    // hash's 1024 texels per axis. The cell stays the contact range and the
    // cells wrap. Measured on SwiftShader: extent 213.1 with 4042 overlapping
    // pairs — the cluster alone gives 211.8 and 4074; a cell widened to fit the
    // grid over the box (195 units) gives 120.4 and 7560, no spread at all.
    const COUNT = 800
    const positions = new Float32Array(COUNT * 2 + 2)
    positions.set(placeClusters(createCluster(COUNT, 120), [[2048, 2048]]))
    positions.set([202048, 2048], COUNT * 2)
    const result = await runCollision(positions, 100)
    expect(extentOf(result.subarray(0, COUNT * 2))).toBeGreaterThan(200)
    expect(countPairsCloserThan(result, 0, COUNT, 0.9 * 12)).toBeLessThan(4600)
    // The outlier stays where it is
    expect(Array.from(result.subarray(COUNT * 2))).toEqual([202048, 2048])
  })
})
