import { describe, it, expect, vi } from 'vitest'
import { luma, type Device, type Framebuffer } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { Graph, GraphSimulation, type GraphConfig } from '@cosmos.gl/graph'
import { getWantedSlotCount } from '@/graph/modules/ForceManyBody'
import { READBACK_WAIT_CAP_MS } from '@/graph/modules/Store'

/**
 * Near-field repulsion sampling above 4,096 points: the `simulationRepulsionSamples`
 * contract (an integer from 2 to 64 fixes the per-cell sample count, applied on the
 * next tick; anything else is rejected) and the automatic count, which starts at
 * the point count's size tier and, in a Graph's own render loop, follows the
 * occupancy measurements once they land, within a time budget and a memory cap.
 * The count is read through the simulation's many-body module, the only place it
 * exists.
 */

/**
 * Just above the all-pairs threshold, so the grid path runs: the tests check when the
 * count is measured and what it picks, not the force at scale, and on a software
 * renderer every point costs on every step. The size tier and what the size affords
 * are the same as at 12,000 points (32 and 64).
 */
const POINTS = 4_500

/**
 * Twelve tight discs, `points` / 12 each. The grid follows the data, so the
 * finest cells divide the span of the disc centres: up to 16,384 points ~2,300
 * units into 256 per axis, about 9 units a cell. The discs' radius grows with the
 * square root of the count, so a cell holds about 40 points at any count on that
 * grid — far above the 8-slot floor. 20,000 points take the 512² grid, about 4.5
 * units a cell.
 */
const clusteredPositions = (points = POINTS, discRadius = 25 * Math.sqrt(points / 12_000)): Float32Array => {
  const positions = new Float32Array(points * 2)
  let seed = 12345
  const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < points; i += 1) {
    const cluster = i % 12
    const angle = random() * Math.PI * 2
    const radius = Math.sqrt(random()) * discRadius
    positions[i * 2] = 1024 + (cluster % 4) * 700 + Math.cos(angle) * radius
    positions[i * 2 + 1] = 1024 + Math.floor(cluster / 4) * 700 + Math.sin(angle) * radius
  }
  return positions
}

type OccupancyReadback = { poll: () => Float32Array | null; issue: (...args: unknown[]) => boolean }
type ManyBody = {
  nearField?: { count: number };
  nearFieldSlotCount: number;
  autoSlotCount?: number;
  hasPendingOccupancyReadback: boolean;
  occupancyReadback?: OccupancyReadback;
}
const manyBody = (simulation: GraphSimulation): ManyBody | undefined =>
  (simulation as unknown as { forceManyBody?: ManyBody }).forceManyBody

const slotCount = (simulation: GraphSimulation): number | undefined => manyBody(simulation)?.nearField?.count

/** WebGL enums for reading a float layer back as RGBA floats. */
const GL_RGBA = 0x1908
const GL_FLOAT = 0x1406

/** The size tier the automatic count runs before a measurement lands, at `POINTS`. */
const TIER = 32

/** A hot simulation that stays hot: the discs stay dense while the tests read them. */
const BASE_CONFIG: GraphConfig = {
  spaceSize: 4096,
  randomSeed: 7,
  simulationGravity: 0.5,
  simulationRepulsion: 1,
  simulationDecay: 100000,
}

const createSimulation = async (samples?: number, positions = clusteredPositions()): Promise<GraphSimulation> => {
  const simulation = new GraphSimulation({ ...BASE_CONFIG, simulationRepulsionSamples: samples })
  simulation.setPointPositions(positions)
  simulation.applyData()
  await simulation.ready
  return simulation
}

/**
 * Hooks the occupancy readback as the force creates it, before its first copy:
 * `onFirstIssue` runs as a microtask after the first copy is issued (between the
 * frame that issued it and the next), `onFirstReading` as that first reading lands,
 * and hands the force the blocks it returns. `onIssue` and `onReading` do the same
 * for every copy and every reading.
 */
const hookReadback = (simulation: GraphSimulation, hooks: {
  onFirstIssue?: () => void;
  onFirstReading?: (blocks: Float32Array) => Float32Array;
  onIssue?: () => void;
  onReading?: (blocks: Float32Array) => Float32Array;
}): void => {
  const force = manyBody(simulation) as unknown as Record<string, unknown>
  let readback: OccupancyReadback | undefined
  let issued = false
  let served = false
  Object.defineProperty(force, 'occupancyReadback', {
    configurable: true,
    get: () => readback,
    set: (value: OccupancyReadback | undefined) => {
      readback = value
      if (!value) return
      const { issue, poll } = { issue: value.issue.bind(value), poll: value.poll.bind(value) }
      value.issue = (...args: unknown[]): boolean => {
        const result = issue(...args)
        if (result) hooks.onIssue?.()
        if (result && !issued && hooks.onFirstIssue) {
          issued = true
          queueMicrotask(hooks.onFirstIssue)
        }
        return result
      }
      value.poll = (): Float32Array | null => {
        const polled = poll()
        const blocks = polled && hooks.onReading ? hooks.onReading(polled) : polled
        if (!blocks || served || !hooks.onFirstReading) return blocks
        served = true
        return hooks.onFirstReading(blocks)
      }
    },
  })
}

type RunningGraph = {
  graph: Graph;
  simulation: GraphSimulation;
  /** Simulation ticks so far. */
  ticks: () => number;
  /** Runs `callback` inside the next tick, with the step's slot count still allocated. */
  onNextTick: (callback: () => void) => void;
  destroy: () => void;
}

/**
 * A Graph running its own render loop, the one host that measures occupancy.
 * `beforeData` runs once the force modules exist, before any frame steps them.
 */
const createRunningGraph = async ({ positions = clusteredPositions(), config = {}, devicePromise, beforeData }: {
  positions?: Float32Array;
  config?: GraphConfig;
  devicePromise?: Promise<Device>;
  beforeData?: (simulation: GraphSimulation, graph: Graph) => void;
} = {}): Promise<RunningGraph> => {
  const div = document.createElement('div')
  div.style.width = '300px'
  div.style.height = '300px'
  document.body.appendChild(div)
  let ticks = 0
  let next: (() => void) | undefined
  const graph = new Graph(div, {
    ...BASE_CONFIG,
    ...config,
    onSimulationTick: (): void => {
      ticks += 1
      const callback = next
      next = undefined
      callback?.()
    },
  }, devicePromise)
  await graph.ready
  const simulation = (graph as unknown as { simulation: GraphSimulation }).simulation
  beforeData?.(simulation, graph)
  graph.setPointPositions(positions)
  graph.render()
  return {
    graph,
    simulation,
    ticks: (): number => ticks,
    onNextTick: (callback: () => void): void => { next = callback },
    destroy: (): void => { graph.destroy(); div.remove() },
  }
}

/** Lets the render loop run until `done`, or the time runs out. */
const waitUntil = async (done: () => boolean, maxMs = 20_000): Promise<void> => {
  const end = performance.now() + maxMs
  while (!done() && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 10))
}

const stepUntil = async (simulation: GraphSimulation, done: () => boolean, maxSteps: number): Promise<void> => {
  for (let i = 0; i < maxSteps && !done(); i += 1) {
    simulation.step()
    // The occupancy read lands on a later tick, behind a GPU fence.
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

describe('near-field sampling', () => {
  it('rejects a sample count that is not an integer from 2 to 64', () => {
    // 1 is out: with one slot a cell's sample can be the point itself, and the estimate falls short
    for (const samples of [0, 1, -8, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 65]) {
      expect(() => new GraphSimulation({ simulationRepulsionSamples: samples })).toThrow(RangeError)
    }
    // Both ends: the floor the estimate needs, and the ceiling every device allocates (32 layers per array).
    // A device that never arrives: the value is checked before one would be made, and nothing is left to run
    const never = new Promise<never>(() => {})
    for (const samples of [2, 64]) {
      let simulation: GraphSimulation | undefined
      expect(() => { simulation = new GraphSimulation({ simulationRepulsionSamples: samples }, never) }).not.toThrow()
      simulation?.destroy()
    }
  })

  it('rejects it where it is passed, before the device is ready', () => {
    // A device that never arrives: the setters queue their work until it does, and
    // a value rejected only when that work ran would throw from nowhere, later
    const never = new Promise<never>(() => {})
    const simulation = new GraphSimulation({}, never)
    const graph = new Graph(null, {}, never)
    try {
      expect(() => simulation.setConfig({ simulationRepulsionSamples: 0 })).toThrow(RangeError)
      expect(() => graph.setConfig({ simulationRepulsionSamples: -8 })).toThrow(RangeError)
      expect(() => graph.setConfigPartial({ simulationRepulsionSamples: 1.5 })).toThrow(RangeError)
    } finally {
      simulation.destroy()
      graph.destroy()
    }
  })

  it('fixes the count to the configured value and applies a change on the next tick', async () => {
    const simulation = await createSimulation(16)
    try {
      expect(slotCount(simulation)).toBe(16)
      await stepUntil(simulation, () => false, 40)
      expect(slotCount(simulation)).toBe(16)

      simulation.setConfig({ simulationRepulsionSamples: 24 })
      simulation.step()
      expect(slotCount(simulation)).toBe(24)
      const positions = simulation.getPointPositionsArray()
      expect(positions.every(Number.isFinite)).toBe(true)
    } finally {
      simulation.destroy()
    }
  })

  it('peels every point of a cell into the slots exactly once, at an odd and an even count', async () => {
    // 900 groups of 5 points, each group far smaller than a finest cell, the groups far
    // apart: no cell holds more than 5 points, so at 5 or more samples a step lists every
    // point once across the two slot arrays (slot k in layer k / 2 of array k % 2). A wrong
    // layer of the previous pass, a depth not cleared or a pass reading the array it writes
    // would drop or repeat points. 5 leaves the last layer in the even array alone
    const groups = 900
    const perGroup = 5
    const positions = new Float32Array(groups * perGroup * 2)
    for (let g = 0; g < groups; g += 1) {
      for (let p = 0; p < perGroup; p += 1) {
        const i = g * perGroup + p
        positions[i * 2] = 500 + (g % 30) * 100 + p * 0.1
        positions[i * 2 + 1] = 500 + Math.floor(g / 30) * 100 + p * 0.07
      }
    }
    for (const samples of [5, 6]) {
      const simulation = await createSimulation(samples, positions)
      try {
        simulation.step()
        const nearField = (manyBody(simulation) as unknown as { nearField: { fbos: Framebuffer[]; gridSize: number } }).nearField
        const device = simulation.device!
        const listed = new Uint16Array(groups * perGroup)
        for (const fbo of nearField.fbos) {
          // rg32float layers read as RGBA floats: [point index or -1, hash, 0, 0]
          const texels = device.readPixelsToArrayWebGL(fbo, { sourceFormat: GL_RGBA, sourceType: GL_FLOAT }) as Float32Array
          for (let t = 0; t < texels.length; t += 4) {
            const index = texels[t]!
            if (index >= 0) listed[index] = listed[index]! + 1
          }
        }
        expect(nearField.fbos.length, 'slot layers').toBe(samples)
        expect(Array.from(listed).every(times => times === 1), `every point listed once at ${samples} samples`).toBe(true)
      } finally {
        simulation.destroy()
      }
    }
  })

  it('repels both points of a pair alike when the second slot comes from the odd array', async () => {
    // 2,250 pairs half a unit apart on a lattice 80 units wide: a pair's cell holds just its
    // two points, slot 0 in the even array and slot 1 in the odd one, and each point is
    // repelled by the other. The far field moves every pair's centre too, smoothly across the
    // lattice, so a pair's centre is compared with its four neighbours': along the pair's axis
    // the two agree. Were the force pass to read slot 1 from the wrong array, one point would
    // not see the other, and the centre would kick along the axis by about the opening
    const side = 45
    const rows = 50
    const pairs = side * rows
    const positions = new Float32Array(pairs * 4)
    for (let g = 0; g < pairs; g += 1) {
      const angle = (g * 2.399) % (2 * Math.PI)
      const x = 500 + (g % side) * 80
      const y = 500 + Math.floor(g / side) * 80
      positions.set([x - 0.25 * Math.cos(angle), y - 0.25 * Math.sin(angle), x + 0.25 * Math.cos(angle), y + 0.25 * Math.sin(angle)], g * 4)
    }
    const simulation = new GraphSimulation({ ...BASE_CONFIG, simulationGravity: 0, simulationRepulsionSamples: 2 })
    simulation.setPointPositions(positions)
    simulation.applyData()
    await simulation.ready
    try {
      const before = simulation.getPointPositionsArray()
      simulation.step()
      const after = simulation.getPointPositionsArray()
      const shift = (i: number): [number, number] => [after[i]! - before[i]!, after[i + 1]! - before[i + 1]!]
      const centreShift = (g: number): [number, number] => {
        const [ax, ay] = shift(g * 4)
        const [bx, by] = shift(g * 4 + 2)
        return [(ax + bx) / 2, (ay + by) / 2]
      }
      const residuals: number[] = []
      const openings: number[] = []
      for (let g = 0; g < pairs; g += 1) {
        const column = g % side
        const row = Math.floor(g / side)
        if (column === 0 || column === side - 1 || row === 0 || row === rows - 1) continue
        const a = g * 4
        const ux = before[a + 2]! - before[a]!
        const uy = before[a + 3]! - before[a + 1]!
        const length = Math.hypot(ux, uy)
        const along = ([dx, dy]: [number, number]): number => (dx * ux + dy * uy) / length
        const neighbours = [centreShift(g - 1), centreShift(g + 1), centreShift(g - side), centreShift(g + side)]
        const [cx, cy] = centreShift(g)
        const mx = neighbours.reduce((sum, [x]) => sum + x, 0) / 4
        const my = neighbours.reduce((sum, [, y]) => sum + y, 0) / 4
        residuals.push(Math.abs(along([cx - mx, cy - my])))
        openings.push((along(shift(a + 2)) - along(shift(a))) / 2)
      }
      const median = (values: number[]): number => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)]!
      expect(median(openings), 'the median opening of a pair').toBeGreaterThan(0)
      // About 5e-5 against an opening of about 1 when right; about 0.6 with the wrong array
      expect(median(residuals) / median(openings), 'a pair\'s centre against its neighbours, along its axis').toBeLessThan(0.05)
    } finally {
      simulation.destroy()
    }
  })

  it('starts the automatic count at the size tier and raises it for a dense layout', async () => {
    const { simulation, destroy } = await createRunningGraph()
    try {
      expect(manyBody(simulation)?.autoSlotCount).toBeUndefined()
      expect(manyBody(simulation)?.nearFieldSlotCount).toBe(TIER)
      await waitUntil(() => slotCount(simulation) === 64)
      // The first measurement sees the initial discs: it wants the cells
      // sampled exhaustively, and `POINTS` afford the full range.
      expect(slotCount(simulation)).toBe(64)
      const positions = simulation.getPointPositionsArray()
      expect(positions.every(Number.isFinite)).toBe(true)
    } finally {
      destroy()
    }
  })

  it('wants the smallest count that leaves at most 1 % of the points in fuller cells', () => {
    // [points in cells of more than 8, more than 16, more than 32]
    expect(getWantedSlotCount(1000, [0, 0, 0])).toBe(8)
    expect(getWantedSlotCount(1000, [10, 0, 0]), 'exactly 1 % over 8').toBe(8)
    // A dense core of 5 % of the points: the typical cell holds a handful, the core needs 16
    expect(getWantedSlotCount(1000, [50, 0, 0])).toBe(16)
    expect(getWantedSlotCount(1000, [50, 20, 0])).toBe(32)
    expect(getWantedSlotCount(1000, [50, 20, 11])).toBe(64)
  })

  it('raises the count for a dense core the typical cell does not show', async () => {
    // 5 % of the points on a lattice about 3.4 to a finest cell's side, so 9 to 16 to a cell
    // wherever the grid falls, and the rest spread thin: the typical point's cell holds one
    // or two, which on its own would want the floor of 8
    const core = Math.round(POINTS * 0.05)
    const columns = Math.ceil(Math.sqrt(core))
    const spacing = 2.6
    const positions = new Float32Array(POINTS * 2)
    let seed = 3
    const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    for (let i = 0; i < core; i += 1) {
      positions[i * 2] = 1950 + (i % columns) * spacing
      positions[i * 2 + 1] = 1950 + Math.floor(i / columns) * spacing
    }
    for (let i = core; i < POINTS; i += 1) {
      positions[i * 2] = 1000 + random() * 2000
      positions[i * 2 + 1] = 1000 + random() * 2000
    }
    const { simulation, destroy } = await createRunningGraph({ positions })
    try {
      await waitUntil(() => manyBody(simulation)?.autoSlotCount !== undefined)
      expect(manyBody(simulation)?.autoSlotCount, 'the first reading, on the initial layout').toBe(16)
    } finally {
      destroy()
    }
  })

  it('measures every 30 steps, applies the first reading at once and a change after two that agree', async () => {
    // Every reading is served: the first wants the tier's 32, the next ones 64
    // 100 points, half of them in cells fuller than every count below the one wanted
    const occupancyBlocks = (wanted: 32 | 64): Float32Array => {
      const blocks = new Float32Array(16 * 16 * 4)
      blocks.set([100, 50, 50, wanted === 64 ? 50 : 0])
      return blocks
    }
    const issuedAt: number[] = []
    let readings = 0
    let countAfterSecond: number | undefined
    const { simulation, destroy } = await createRunningGraph({
      beforeData: (simulation) => {
        hookReadback(simulation, {
          onIssue: () => { issuedAt.push((manyBody(simulation) as unknown as { occupancyTick: number }).occupancyTick) },
          onReading: () => {
            readings += 1
            // Before this reading is applied: the second one only proposed 64
            if (readings === 3) countAfterSecond = manyBody(simulation)?.autoSlotCount
            return occupancyBlocks(readings === 1 ? 32 : 64)
          },
        })
        // The step schedule alone: every hold is reported as none, so the hold budget does
        // not space the readings
        const force = manyBody(simulation) as unknown as { collectOccupancy: (heldMs?: number) => void }
        const collect = force.collectOccupancy.bind(force)
        force.collectOccupancy = (): void => collect(0)
      },
    })
    try {
      await waitUntil(() => issuedAt.length >= 4, 50_000)
      const gaps = issuedAt.slice(1, 4).map((tick, i) => tick - issuedAt[i]!)
      expect(gaps, 'steps between the measurements').toEqual([30, 30, 30])
      expect(countAfterSecond, 'the count after one reading that wants 64').toBe(32)
      await waitUntil(() => slotCount(simulation) === 64, 20_000)
      expect(slotCount(simulation), 'the count after two that agree').toBe(64)
    } finally {
      destroy()
    }
  }, 60_000)

  it('waits a hundred times a reading\'s hold before the next, across a restart too', async () => {
    // Every reading is reported as having held its frame for 300 ms: the next may come no
    // sooner than 30 s later, where the step interval alone would allow one within a second.
    // A change of the key restarts the measurement but keeps that wait, so toggling it on a
    // loaded GPU cannot hold a frame on every toggle
    const issuedAt: number[] = []
    const { graph, simulation, destroy } = await createRunningGraph({
      beforeData: (simulation) => {
        hookReadback(simulation, { onIssue: () => { issuedAt.push(performance.now()) } })
        // Graph passes a hold only on the frame after one, when a copy is there to collect: the
        // frames that collect one report it as 300 ms, the others pass what Graph measured
        const force = manyBody(simulation) as unknown as { collectOccupancy: (heldMs?: number) => void; hasPendingOccupancyReadback: boolean }
        const collect = force.collectOccupancy.bind(force)
        force.collectOccupancy = (heldMs = 0): void => collect(force.hasPendingOccupancyReadback ? 300 : heldMs)
      },
    })
    try {
      await waitUntil(() => manyBody(simulation)?.autoSlotCount !== undefined)
      await new Promise(resolve => setTimeout(resolve, 3000))
      expect(issuedAt.length, 'copies issued in the 3 s after a reading that held 300 ms').toBe(1)
      graph.setConfigPartial({ simulationRepulsionSamples: 16 })
      graph.setConfigPartial({ simulationRepulsionSamples: undefined })
      await new Promise(resolve => setTimeout(resolve, 2000))
      expect(issuedAt.length, 'copies issued in the 2 s after the key change').toBe(1)
    } finally {
      destroy()
    }
  })

  it('charges the hold the cap ends when the occupancy copy never lands', async () => {
    // Fences that never signal: the first occupancy copy holds the frame until the cap drops
    // it, and that second is the reading's cost all the same
    const fences = vi.spyOn(WebGL2RenderingContext.prototype, 'clientWaitSync')
      .mockReturnValue(WebGL2RenderingContext.TIMEOUT_EXPIRED)
    const { simulation, destroy } = await createRunningGraph()
    try {
      const force = manyBody(simulation) as unknown as { occupancyNotBefore: number }
      await waitUntil(() => force.occupancyNotBefore > 0, READBACK_WAIT_CAP_MS + 5000)
      // A hundred times the capped hold
      expect(force.occupancyNotBefore - performance.now(), 'the wait before the next measurement').toBeGreaterThan(50 * READBACK_WAIT_CAP_MS)
    } finally {
      fences.mockRestore()
      destroy()
    }
  })

  it('charges nothing for a hold no occupancy copy was part of', async () => {
    // A frame held for another copy alone (a pick, tracked positions): the occupancy
    // measurement did not cause it, and its schedule stays as it was. The loop is off, so no
    // occupancy copy is in flight, and a pending copy is stubbed for three polls
    const { graph, simulation, destroy } = await createRunningGraph({ config: { enableRenderLoop: false } })
    try {
      const runFrame = (graph as unknown as { runFrame: (now: number) => void }).runFrame.bind(graph)
      let polls = 0
      Object.defineProperty(simulation, 'isReadbackPending', { configurable: true, get: () => { polls += 1; return polls <= 3 } })
      const force = manyBody(simulation) as unknown as { occupancyNotBefore: number }
      force.occupancyNotBefore = 0
      runFrame(performance.now())
      await waitUntil(() => polls > 3, 2000)
      await new Promise(resolve => setTimeout(resolve, 50))
      Reflect.deleteProperty(simulation, 'isReadbackPending')
      expect(polls, 'the frame was held').toBeGreaterThan(3)
      expect(force.occupancyNotBefore, 'the wait before the next measurement').toBe(0)
    } finally {
      destroy()
    }
  })

  it('falls back to the automatic count when a sample count written to the config directly is not valid', async () => {
    // `config` is a public field: a write past the setters skips validateConfig, and the
    // force must not allocate 1000 slots from it
    const { graph, simulation, onNextTick, destroy } = await createRunningGraph()
    try {
      graph.config.simulationRepulsionSamples = 1000
      let counted: number | undefined
      let automatic: number | undefined
      onNextTick(() => {
        counted = slotCount(simulation)
        automatic = manyBody(simulation)?.autoSlotCount ?? TIER
      })
      await waitUntil(() => counted !== undefined)
      expect(counted, 'the slots of the first step after the write: the automatic count').toBe(automatic)
    } finally {
      destroy()
    }
  })

  it('keeps the measured count across a data apply of the same point count, and starts over for another', async () => {
    const { graph, simulation, onNextTick, destroy } = await createRunningGraph()
    try {
      await waitUntil(() => slotCount(simulation) === 64)
      expect(slotCount(simulation)).toBe(64)
      // The same points again: the count in force stays (no transition, so the simulation runs on)
      graph.setPointPositions(clusteredPositions())
      graph.render(undefined, 0)
      expect(manyBody(simulation)?.autoSlotCount).toBe(64)
      // Fewer points: a new layout, measured afresh from its size tier. The first step after
      // the apply runs the tier's slots; a reading can land no earlier than the frame after it
      graph.setPointPositions(clusteredPositions().subarray(0, (POINTS - 100) * 2))
      graph.render(undefined, 0)
      expect(manyBody(simulation)?.autoSlotCount).toBeUndefined()
      let counted: number | undefined
      onNextTick(() => { counted = slotCount(simulation) })
      await waitUntil(() => counted !== undefined)
      expect(counted, 'the slots the first step after the apply ran').toBe(TIER)
    } finally {
      destroy()
    }
  })

  it('measures while the same points are applied on every frame', async () => {
    // Positions streamed in: every apply rebuilds the force for the same point count. A
    // read in flight across the apply still lands, or nothing would ever be measured
    const { graph, simulation, destroy } = await createRunningGraph()
    try {
      const positions = clusteredPositions()
      for (let i = 0; i < 600 && slotCount(simulation) !== 64; i += 1) {
        graph.setPointPositions(positions)
        graph.render(undefined, 0)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(slotCount(simulation), 'a measurement to land between the applies').toBe(64)
    } finally {
      destroy()
    }
  })

  it('runs the size tier and reads nothing back where the host steps the simulation itself', async () => {
    // Without Graph's frame hold the host keeps queueing frames behind a copy, and the
    // collect waits for all of them: a bare simulation and a headless graph never measure
    const simulation = await createSimulation()
    const graph = new Graph(null, BASE_CONFIG)
    try {
      graph.setPointPositions(clusteredPositions())
      graph.render()
      await graph.ready
      const headless = (graph as unknown as { simulation: GraphSimulation }).simulation
      for (let i = 0; i < 100; i += 1) {
        simulation.step()
        graph.step()
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      for (const host of [simulation, headless]) {
        expect(slotCount(host)).toBe(TIER)
        expect(manyBody(host)?.occupancyReadback, 'an occupancy read issued').toBeUndefined()
      }
    } finally {
      simulation.destroy()
      graph.destroy()
    }
  })

  it('runs the size tier and reads nothing back where the host drives the frames', async () => {
    // renderOneFrame() runs the same frame as the render loop, but nothing holds the host's
    // next frame for the copy: what the host submits after it sits ahead of the collect
    const { graph, simulation, destroy } = await createRunningGraph({ config: { enableRenderLoop: false } })
    try {
      for (let i = 0; i < 100; i += 1) {
        graph.renderOneFrame()
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      expect(slotCount(simulation)).toBe(TIER)
      expect(manyBody(simulation)?.occupancyReadback, 'an occupancy read issued').toBeUndefined()
    } finally {
      destroy()
    }
  })

  it('runs the size tier and reads nothing back on a device the host shares', async () => {
    // The loop holds its own next frame, not the host's work on the same device
    const canvas = document.createElement('canvas')
    const device = await luma.createDevice({ type: 'webgl', adapters: [webgl2Adapter], createCanvasContext: { canvas } })
    const { simulation, ticks, destroy } = await createRunningGraph({ devicePromise: Promise.resolve(device) })
    try {
      await waitUntil(() => ticks() > 40)
      expect(ticks(), 'the loop to step past a measurement interval').toBeGreaterThan(40)
      expect(slotCount(simulation)).toBe(TIER)
      expect(manyBody(simulation)?.occupancyReadback, 'an occupancy read issued').toBeUndefined()
    } finally {
      destroy()
      device.canvasContext?.destroy()
      device.destroy()
    }
  })

  it('drops a reading in flight when the loop is turned off, before the host frame collects it', async () => {
    let off = false
    const { graph, simulation, destroy } = await createRunningGraph({
      beforeData: (simulation, graph) => {
        hookReadback(simulation, { onFirstIssue: () => { graph.setConfigPartial({ enableRenderLoop: false }); off = true } })
      },
    })
    try {
      await waitUntil(() => off)
      expect(manyBody(simulation)?.hasPendingOccupancyReadback, 'the first reading in flight').toBe(true)
      // Long enough for the copy to land: the host frame would otherwise collect it
      await new Promise(resolve => setTimeout(resolve, 200))
      graph.renderOneFrame()
      expect(manyBody(simulation)?.hasPendingOccupancyReadback).toBe(false)
      expect(manyBody(simulation)?.autoSlotCount).toBeUndefined()
    } finally {
      destroy()
    }
  })

  it('caps the automatic count by slot memory where the grid is at its largest', async () => {
    // 20,000 points take the 512² grid: 64 slots there would be 2 × 32 layers × 512² × 8 bytes
    // (128 MiB). The cap holds them to 16 however full the cells, the size tier's count there
    const { simulation, destroy } = await createRunningGraph({ positions: clusteredPositions(20_000, 25) })
    try {
      await waitUntil(() => manyBody(simulation)?.autoSlotCount !== undefined)
      expect(manyBody(simulation)?.autoSlotCount, 'a measurement above the cap to land').toBeGreaterThan(16)
      await waitUntil(() => slotCount(simulation) !== 16, 200)
      expect(slotCount(simulation)).toBe(16)
    } finally {
      destroy()
    }
  })

  it('does not measure where the budget already pins the count to the floor', async () => {
    // The time budget and the memory cap together afford 16 up to 100,000 points and 8 above
    // (1.6M point-samples rounded down to a power of two), whatever the cells hold, so a read
    // above 100,000 would change nothing
    const lattice = (points: number): Float32Array => {
      const positions = new Float32Array(points * 2)
      for (let i = 0; i < points; i += 1) {
        positions[i * 2] = 1024 + (i % 500) * 4
        positions[i * 2 + 1] = 1024 + Math.floor(i / 500) * 4
      }
      return positions
    }
    for (const [points, measured] of [[100_000, true], [100_001, false]] as const) {
      const { simulation, ticks, destroy } = await createRunningGraph({ positions: lattice(points) })
      try {
        const read = (): boolean => manyBody(simulation)?.occupancyReadback !== undefined
        // The first step of the loop takes the first reading, where one is taken at all
        await waitUntil(() => ticks() > 1 || read())
        expect(ticks() > 1 || read(), `a step at ${points} points`).toBe(true)
        expect(read(), `an occupancy read at ${points} points`).toBe(measured)
        if (!measured) expect(slotCount(simulation), `${points} points`).toBe(8)
      } finally {
        destroy()
      }
    }
  })

  it('ignores a measurement that reads back no finite occupancy', async () => {
    // The first reading is replaced as it lands, so it is the one the count would apply at once
    let served = false
    const { simulation, destroy } = await createRunningGraph({
      beforeData: (simulation) => {
        hookReadback(simulation, { onFirstReading: (blocks) => { served = true; return blocks.fill(Number.NaN) } })
      },
    })
    try {
      await waitUntil(() => served)
      expect(served, 'a reading to land').toBe(true)
      expect(manyBody(simulation)?.autoSlotCount, 'the count the NaN reading leaves').toBeUndefined()
      expect(manyBody(simulation)?.nearFieldSlotCount).toBe(TIER)
    } finally {
      destroy()
    }
  })

  it('drops a reading in flight when a step runs outside the render loop', async () => {
    // A step() between the frame that issued the copy and the one that collects it: the
    // collect would wait behind that step's passes
    let pending: boolean[] | undefined
    const { destroy } = await createRunningGraph({
      beforeData: (simulation, graph) => {
        hookReadback(simulation, {
          onFirstIssue: () => {
            const before = manyBody(simulation)?.hasPendingOccupancyReadback ?? false
            graph.step()
            pending = [before, manyBody(simulation)?.hasPendingOccupancyReadback ?? false]
          },
        })
      },
    })
    try {
      await waitUntil(() => pending !== undefined)
      expect(pending, 'a reading in flight before the step, none after').toEqual([true, false])
    } finally {
      destroy()
    }
  })

  it('starts the measurement over when the key changes, with no step in between', async () => {
    // The simulation paused: the layout may still change (a drag, an apply) while the count
    // is fixed, so a reading from before the key was set is not reused once it is unset
    const { graph, simulation, destroy } = await createRunningGraph()
    try {
      await waitUntil(() => slotCount(simulation) === 64)
      expect(manyBody(simulation)?.autoSlotCount).toBe(64)
      graph.pause()
      graph.setConfigPartial({ simulationRepulsionSamples: 8 })
      graph.setConfigPartial({ simulationRepulsionSamples: undefined })
      expect(manyBody(simulation)?.autoSlotCount).toBeUndefined()
      expect(manyBody(simulation)?.nearFieldSlotCount).toBe(TIER)
    } finally {
      destroy()
    }
  })

  it('drops a reading in flight when the key changes', async () => {
    let pending: boolean[] | undefined
    const { destroy } = await createRunningGraph({
      beforeData: (simulation, graph) => {
        hookReadback(simulation, {
          onFirstIssue: () => {
            const before = manyBody(simulation)?.hasPendingOccupancyReadback ?? false
            graph.setConfigPartial({ simulationRepulsionSamples: 16 })
            pending = [before, manyBody(simulation)?.hasPendingOccupancyReadback ?? false]
          },
        })
      },
    })
    try {
      await waitUntil(() => pending !== undefined)
      expect(pending, 'a reading in flight before the change, none after').toEqual([true, false])
    } finally {
      destroy()
    }
  })

  it('a running Graph collects the occupancy copy before its frame queues a pass, never inside a step', async () => {
    // `getBufferSubData` waits for every command queued before it, fence or no fence: the
    // frame collects its copies first and issues them last, and the step does neither
    const div = document.createElement('div')
    div.style.width = '300px'
    div.style.height = '300px'
    document.body.appendChild(div)
    const graph = new Graph(div, BASE_CONFIG)
    const simulation = (graph as unknown as { simulation: GraphSimulation }).simulation
    const runStep = simulation.runSimulationStep.bind(simulation)
    let inStep = false
    simulation.runSimulationStep = (...args: Parameters<GraphSimulation['runSimulationStep']>): boolean => {
      inStep = true
      try { return runStep(...args) } finally { inStep = false }
    }
    const read = WebGL2RenderingContext.prototype.getBufferSubData as (...args: unknown[]) => void
    let readsInStep = 0
    let readsOutside = 0
    const counted = function (this: WebGL2RenderingContext, ...args: unknown[]): void {
      if (inStep) readsInStep += 1
      else readsOutside += 1
      read.apply(this, args)
    }
    const spy = vi.spyOn(WebGL2RenderingContext.prototype, 'getBufferSubData').mockImplementation(counted as never)
    try {
      graph.setPointPositions(clusteredPositions())
      graph.render()
      await graph.ready
      for (let i = 0; i < 600 && slotCount(simulation) !== 64; i += 1) await new Promise(resolve => setTimeout(resolve, 10))
      expect(readsInStep, 'reads collected inside a step').toBe(0)
      expect(slotCount(simulation), 'the measurement to land').toBe(64)
      expect(readsOutside, 'reads collected at a frame start').toBeGreaterThan(0)
    } finally {
      spy.mockRestore()
      graph.destroy()
      div.remove()
    }
  })
})
