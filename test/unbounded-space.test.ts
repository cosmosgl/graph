import { describe, it, expect } from 'vitest'
import { luma, Texture, type Device } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { DataBounds } from '@/graph/modules/Shared/data-bounds'
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
    // Size 12: a 12-unit contact range. A hash anchored at world zero divided
    // the space into 341 cells of 4096 / 341 = 12.01 units, so moving the
    // cluster by a distance that is not a multiple of half a cell cut it at
    // different cell boundaries — and the force reads cell centroids, so the
    // cut decides the push. Ten steps: long enough for the cut to show, short
    // enough that float rounding at the different offsets has not compounded
    // through the collisions yet.
    const COUNT = 800
    const cluster = createCluster(COUNT, 120)
    const layoutAt = async (cx: number, cy: number): Promise<Float64Array> => {
      const result = await runCollision(placeClusters(cluster, [[cx, cy]]), 10)
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
      // Measured on SwiftShader, as a fraction of the layout's extent: the
      // space-anchored hash 9.3e-3 at (1000, 3100) and 6.4e-3 at
      // (2900.37, 1500.71); the data-anchored hash 2.2e-6 and 2.6e-6.
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
    // enough to share texels needs more room than the position clamp allows
    // in SwiftShader's 8192-unit maximum space.)
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
