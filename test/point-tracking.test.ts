import { describe, it, expect } from 'vitest'
import { luma, type Device } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { Graph, GraphSimulation, type GraphConfig, type PointTracker } from '@cosmos.gl/graph'

/**
 * Tracked point positions and the non-blocking reads, on engines without a
 * render frame: a headless `Graph` and a standalone `GraphSimulation`, both
 * driven with `step()` on a real WebGL 2 context.
 */

/** Forces tuned so a few steps produce visible, bounded movement. */
const SIMULATION_CONFIG: GraphConfig = {
  spaceSize: 4096,
  simulationGravity: 0.5,
  simulationRepulsion: 0.1,
  simulationLinkSpring: 0,
  simulationFriction: 0.7,
  simulationDecay: 5000,
}

/** Four points around the space center, none at equilibrium. */
const POSITIONS = new Float32Array([1000, 1000, 3000, 1000, 1000, 3000, 3000, 3000])

const createHeadlessGraph = async (positions: Float32Array = POSITIONS): Promise<Graph> => {
  const graph = new Graph(null, SIMULATION_CONFIG)
  graph.setPointPositions(positions)
  graph.render()
  await graph.ready
  return graph
}

/** Lets the GPU pass a fence between steps. */
const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 20) })

describe('tracked point positions through Graph', () => {
  it('reports the tracked points at their current positions', async () => {
    const graph = await createHeadlessGraph()
    try {
      graph.trackPointPositionsByIndices([0, 2])
      graph.step()
      const snapshot = graph.getPointPositionsArray()
      const tracked = graph.getTrackedPointPositionsMap()
      expect([...tracked.keys()]).toEqual([0, 2])
      expect(tracked.get(0)).toEqual([snapshot[0], snapshot[1]])
      expect(tracked.get(2)).toEqual([snapshot[4], snapshot[5]])
      // The array keeps the order of the tracked indices
      expect(graph.getTrackedPointPositionsArray()).toEqual([snapshot[0], snapshot[1], snapshot[4], snapshot[5]])
    } finally {
      graph.destroy()
    }
  })

  it('follows the points as they move', async () => {
    const graph = await createHeadlessGraph()
    try {
      graph.trackPointPositionsByIndices([0])
      graph.step()
      const before = [...graph.getTrackedPointPositionsMap().get(0) as [number, number]]
      for (let i = 0; i < 5; i += 1) graph.step()
      const after = graph.getTrackedPointPositionsMap().get(0)
      expect(after).not.toEqual(before)
      const snapshot = graph.getPointPositionsArray()
      expect(after).toEqual([snapshot[0], snapshot[1]])
    } finally {
      graph.destroy()
    }
  })

  it('omits an absent point from the map and keeps its slot as NaN in the array', async () => {
    const graph = await createHeadlessGraph(new Float32Array([1000, 1000, NaN, NaN, 1000, 3000, 3000, 3000]))
    try {
      graph.trackPointPositionsByIndices([0, 1])
      graph.step()
      expect([...graph.getTrackedPointPositionsMap().keys()]).toEqual([0])
      const array = graph.getTrackedPointPositionsArray()
      expect(array).toHaveLength(4)
      expect(Number.isFinite(array[0])).toBe(true)
      expect(Number.isNaN(array[2])).toBe(true)
      expect(Number.isNaN(array[3])).toBe(true)
    } finally {
      graph.destroy()
    }
  })

  it('tracking again replaces the one set a graph follows', async () => {
    const graph = await createHeadlessGraph()
    try {
      graph.trackPointPositionsByIndices([0])
      graph.step()
      expect([...graph.getTrackedPointPositionsMap().keys()]).toEqual([0])
      graph.trackPointPositionsByIndices([1, 2])
      graph.step()
      expect([...graph.getTrackedPointPositionsMap().keys()]).toEqual([1, 2])
      expect(graph.getTrackedPointPositionsArray()).toHaveLength(4)
    } finally {
      graph.destroy()
    }
  })

  it('tracking set before the device is ready is live once it is', async () => {
    const graph = new Graph(null, SIMULATION_CONFIG)
    graph.trackPointPositionsByIndices([1])
    expect(graph.getTrackedPointPositionsMap().size).toBe(0)
    graph.setPointPositions(POSITIONS)
    graph.render()
    await graph.ready
    try {
      const snapshot = graph.getPointPositions()
      expect(graph.getTrackedPointPositionsMap().get(1)).toEqual([snapshot[2], snapshot[3]])
    } finally {
      graph.destroy()
    }
  })

  it('a missing array stops tracking instead of throwing', async () => {
    const graph = await createHeadlessGraph()
    try {
      graph.trackPointPositionsByIndices([0])
      graph.step()
      expect(graph.getTrackedPointPositionsMap().size).toBe(1)
      // Outside the type, but untyped callers have always been able to do it
      graph.trackPointPositionsByIndices(undefined as unknown as number[])
      expect(graph.getTrackedPointPositionsMap().size).toBe(0)
      expect(graph.getTrackedPointPositionsArray()).toEqual([])
    } finally {
      graph.destroy()
    }
  })

  it('reports nothing for an index with no point behind it', async () => {
    const graph = await createHeadlessGraph()
    try {
      graph.trackPointPositionsByIndices([0, 9])
      graph.step()
      expect([...graph.getTrackedPointPositionsMap().keys()]).toEqual([0])
    } finally {
      graph.destroy()
    }
  })
})

const createSimulation = async (positions: Float32Array = POSITIONS): Promise<GraphSimulation> => {
  const simulation = new GraphSimulation(SIMULATION_CONFIG)
  simulation.setPointPositions(positions)
  simulation.applyData()
  await simulation.ready
  return simulation
}

describe('point trackers', () => {
  it('a tracker on a standalone simulation reports its points as a map and as an array', async () => {
    const simulation = await createSimulation()
    try {
      const tracker = simulation.trackPoints([0, 2])
      simulation.step()
      const snapshot = simulation.getPointPositionsArray()
      expect(tracker.indices).toEqual([0, 2])
      expect(tracker.positions().get(0)).toEqual([snapshot[0], snapshot[1]])
      expect(tracker.positions().get(2)).toEqual([snapshot[4], snapshot[5]])
      expect(tracker.positionsArray()).toEqual([snapshot[0], snapshot[1], snapshot[4], snapshot[5]])
    } finally {
      simulation.destroy()
    }
  })

  it('trackers follow their own sets, and one can change or go without touching another', async () => {
    const simulation = await createSimulation()
    try {
      const first = simulation.trackPoints([0])
      const second = simulation.trackPoints([2, 3])
      expect(second).not.toBe(first)
      simulation.step()
      expect([...first.positions().keys()]).toEqual([0])
      expect([...second.positions().keys()]).toEqual([2, 3])

      first.setIndices([1])
      simulation.step()
      const snapshot = simulation.getPointPositionsArray()
      expect(first.positions().get(1)).toEqual([snapshot[2], snapshot[3]])
      expect([...second.positions().keys()]).toEqual([2, 3])

      first.destroy()
      simulation.step()
      expect(first.positions().size).toBe(0)
      expect(first.positionsArray()).toHaveLength(0)
      expect([...second.positions().keys()]).toEqual([2, 3])
    } finally {
      simulation.destroy()
    }
  })

  it('a tracker created before the device is ready follows once it is, and is empty after the engine is gone', async () => {
    const simulation = new GraphSimulation(SIMULATION_CONFIG)
    const tracker = simulation.trackPoints([1])
    expect(tracker.positions().size).toBe(0)
    simulation.setPointPositions(POSITIONS)
    simulation.applyData()
    await simulation.ready
    simulation.step()
    const snapshot = simulation.getPointPositionsArray()
    expect(tracker.positions().get(1)).toEqual([snapshot[2], snapshot[3]])
    simulation.destroy()
    expect(tracker.positions().size).toBe(0)
    // And one asked for afterwards is empty from the start
    const late = simulation.trackPoints([0])
    expect(late.positions().size).toBe(0)
    expect(late.positionsArray()).toHaveLength(0)
  })
})

describe('point trackers on changing sets and data', () => {
  it('an index past the point count appears when the count grows, and goes when it shrinks', async () => {
    const simulation = await createSimulation()
    try {
      const tracker = simulation.trackPoints([0, 5])
      expect([...tracker.positions().keys()]).toEqual([0])

      simulation.setPointPositions(new Float32Array([...POSITIONS, 500, 500, 2000, 2000]))
      simulation.applyData()
      const grown = simulation.getPointPositionsArray()
      expect(tracker.positions().get(5)).toEqual([grown[10], grown[11]])
      expect(tracker.positionsArray()).toEqual([grown[0], grown[1], grown[10], grown[11]])

      simulation.setPointPositions(new Float32Array([1000, 1000, 3000, 1000]))
      simulation.applyData()
      expect([...tracker.positions().keys()]).toEqual([0])
      // The array keeps the slot of the index that has no point any more
      const array = tracker.positionsArray()
      expect(array).toHaveLength(4)
      expect(Number.isNaN(array[2])).toBe(true)
    } finally {
      simulation.destroy()
    }
  })

  it('an empty set reports nothing, and a set given later is followed', async () => {
    const simulation = await createSimulation()
    try {
      const tracker = simulation.trackPoints([0, 1])
      simulation.step()
      tracker.setIndices([])
      expect(tracker.positions().size).toBe(0)
      expect(tracker.positionsArray()).toHaveLength(0)

      tracker.setIndices([3])
      const snapshot = simulation.getPointPositionsArray()
      expect(tracker.positions().get(3)).toEqual([snapshot[6], snapshot[7]])
      // A tracker's own indices are a valid set to give back
      tracker.setIndices(tracker.indices)
      expect(tracker.positions().get(3)).toEqual([snapshot[6], snapshot[7]])

      const empty = simulation.trackPoints([])
      expect(empty.positions().size).toBe(0)
      empty.setIndices([2])
      expect(empty.positions().get(2)).toEqual([snapshot[4], snapshot[5]])
    } finally {
      simulation.destroy()
    }
  })

  it('a tracker destroyed before the device is ready stays empty', async () => {
    const simulation = new GraphSimulation(SIMULATION_CONFIG)
    const tracker = simulation.trackPoints([1])
    tracker.destroy()
    tracker.destroy()
    simulation.setPointPositions(POSITIONS)
    simulation.applyData()
    await simulation.ready
    try {
      simulation.step()
      expect(tracker.positions().size).toBe(0)
      expect(tracker.positionsArray()).toHaveLength(0)
    } finally {
      simulation.destroy()
    }
  })
})

describe('non-blocking reads without a render frame', () => {
  it('a tracker read advances on a standalone simulation', async () => {
    const simulation = await createSimulation()
    try {
      const tracker = simulation.trackPoints([0])
      simulation.step()
      const first = [...tracker.positions({ nonBlocking: true }).get(0) as [number, number]]
      let latest = first
      for (let i = 0; i < 60 && latest[0] === first[0]; i += 1) {
        simulation.step()
        await tick()
        latest = [...tracker.positions({ nonBlocking: true }).get(0) as [number, number]]
      }
      expect(latest).not.toEqual(first)
    } finally {
      simulation.destroy()
    }
  })

  it('the last copy is collected by a read after the simulation has stopped stepping', async () => {
    const simulation = await createSimulation()
    try {
      const tracker = simulation.trackPoints([0])
      simulation.step()
      tracker.positions({ nonBlocking: true })
      // Step and read until a copy has been issued and collected at least once
      for (let i = 0; i < 20; i += 1) {
        simulation.step()
        await tick()
        tracker.positions({ nonBlocking: true })
      }
      // No more steps: the copy issued by the last one must still arrive through reads alone
      const settled = simulation.getPointPositionsArray()
      let latest = tracker.positions({ nonBlocking: true }).get(0)
      for (let i = 0; i < 60 && latest?.[0] !== settled[0]; i += 1) {
        await tick()
        latest = tracker.positions({ nonBlocking: true }).get(0)
      }
      expect(latest).toEqual([settled[0], settled[1]])
    } finally {
      simulation.destroy()
    }
  })

  it('a tracked read advances on a headless graph, where steps are the only frames', async () => {
    const graph = await createHeadlessGraph()
    try {
      graph.trackPointPositionsByIndices([0])
      graph.step()
      // The first read has nothing earlier to return, so it waits
      const first = [...graph.getTrackedPointPositionsMap({ nonBlocking: true }).get(0) as [number, number]]
      let latest = first
      for (let i = 0; i < 60 && latest[0] === first[0]; i += 1) {
        graph.step()
        await tick()
        latest = [...graph.getTrackedPointPositionsMap({ nonBlocking: true }).get(0) as [number, number]]
      }
      expect(latest).not.toEqual(first)
    } finally {
      graph.destroy()
    }
  })

  it('a cluster read advances on a standalone simulation', async () => {
    const simulation = new GraphSimulation(SIMULATION_CONFIG)
    simulation.setPointPositions(POSITIONS)
    simulation.setPointClusters([0, 0, 1, 1])
    simulation.applyData()
    await simulation.ready
    try {
      simulation.step()
      const first = [...simulation.getClusterPositions({ nonBlocking: true })]
      expect(first).toHaveLength(4)
      let latest = first
      for (let i = 0; i < 60 && latest[1] === first[1]; i += 1) {
        simulation.step()
        await tick()
        latest = [...simulation.getClusterPositions({ nonBlocking: true })]
      }
      expect(latest).not.toEqual(first)
    } finally {
      simulation.destroy()
    }
  })
})

describe('non-blocking reads while the set or the data changes', () => {
  it('a set changed while a copy is in flight reports only the new points', async () => {
    const simulation = await createSimulation()
    try {
      const tracker = simulation.trackPoints([0])
      tracker.positions({ nonBlocking: true })
      simulation.step()
      tracker.positions({ nonBlocking: true }) // issues a copy of point 0
      tracker.setIndices([2, 3])
      simulation.step()
      const snapshot = simulation.getPointPositionsArray()
      let tracked = tracker.positions({ nonBlocking: true })
      expect([...tracked.keys()]).toEqual([2, 3])
      for (let i = 0; i < 60 && tracked.get(2)?.[0] !== snapshot[4]; i += 1) {
        await tick()
        tracked = tracker.positions({ nonBlocking: true })
      }
      expect(tracked.get(2)).toEqual([snapshot[4], snapshot[5]])
      expect(tracked.get(3)).toEqual([snapshot[6], snapshot[7]])
    } finally {
      simulation.destroy()
    }
  })
})

/**
 * A non-blocking read may be behind on coordinates, never on which points exist.
 * Every scenario starts the same way: a paused simulation, a tracker that has a
 * cache, and a copy of the old point list in flight.
 */
describe('non-blocking reads when the point list changes', () => {
  const withCopyInFlight = async (
    positions: Float32Array,
    indices: number[],
    run: (simulation: GraphSimulation, read: () => ReadonlyMap<number, [number, number]>, tracker: PointTracker) => Promise<void>
  ): Promise<void> => {
    const simulation = await createSimulation(positions)
    try {
      simulation.pause()
      const tracker = simulation.trackPoints(indices)
      const read = (): ReadonlyMap<number, [number, number]> => tracker.positions({ nonBlocking: true })
      read() // nothing earlier to return: this one waits and fills the cache
      simulation.setPointPosition(0, 1500, 1500)
      read() // issues a copy of the list as it is now
      await run(simulation, read, tracker)
    } finally {
      simulation.destroy()
    }
  }

  /** Reads until `isDone`, checking every map on the way. */
  const readUntil = async (
    read: () => ReadonlyMap<number, [number, number]>,
    isDone: (tracked: ReadonlyMap<number, [number, number]>) => boolean,
    check: (tracked: ReadonlyMap<number, [number, number]>) => void
  ): Promise<ReadonlyMap<number, [number, number]>> => {
    let tracked = read()
    check(tracked)
    for (let i = 0; i < 60 && !isDone(tracked); i += 1) {
      await tick()
      tracked = read()
      check(tracked)
    }
    return tracked
  }

  it('a point past a smaller count is gone from the first read', async () => {
    await withCopyInFlight(POSITIONS, [0, 3], async (simulation, read) => {
      simulation.setPointPositions(new Float32Array([100, 100, 200, 200]))
      simulation.applyData()
      const first = read()
      expect(first.has(3)).toBe(false)
      expect(first.has(0)).toBe(true)
      const settled = await readUntil(read, (tracked) => tracked.get(0)?.[0] === 100, (tracked) => {
        expect(tracked.has(3)).toBe(false)
      })
      expect([...settled.entries()]).toEqual([[0, [100, 100]]])
    })
  })

  it('a point removed with NaN is gone from the first read', async () => {
    await withCopyInFlight(POSITIONS, [0, 3], async (simulation, read) => {
      simulation.setPointPositions(new Float32Array([1000, 1000, 3000, 1000, 1000, 3000, NaN, NaN]))
      simulation.applyData()
      expect([...read().keys()]).toEqual([0])
    })
  })

  it('a point that appears is not reported before its position has been read', async () => {
    await withCopyInFlight(POSITIONS, [0, 5], async (simulation, read) => {
      simulation.setPointPositions(new Float32Array([...POSITIONS, 500, 500, 700, 700]))
      simulation.applyData()
      expect(read().has(5)).toBe(false)
      const settled = await readUntil(read, (tracked) => tracked.has(5), (tracked) => {
        // Never the zeros an index past the old count gathered
        if (tracked.has(5)) expect(tracked.get(5)).toEqual([700, 700])
      })
      expect(settled.get(5)).toEqual([700, 700])
    })
  })

  it('a blocking read right after the change reports the new point where it is', async () => {
    await withCopyInFlight(POSITIONS, [0, 5], async (simulation, read, tracker) => {
      simulation.setPointPositions(new Float32Array([...POSITIONS, 500, 500, 700, 700]))
      simulation.applyData()
      // The non-blocking read trims its old cache; that cache must not pass for current
      expect(read().has(5)).toBe(false)
      expect(tracker.positions().get(5)).toEqual([700, 700])
    })
  })

  it('a revived point is not reported before its position has been read', async () => {
    await withCopyInFlight(new Float32Array([1000, 1000, NaN, NaN, 1000, 3000, 3000, 3000]), [0, 1], async (simulation, read) => {
      simulation.setPointPositions(new Float32Array([1000, 1000, 2500, 2600, 1000, 3000, 3000, 3000]))
      simulation.applyData()
      expect(read().has(1)).toBe(false)
      const settled = await readUntil(read, (tracked) => tracked.has(1), (tracked) => {
        if (tracked.has(1)) expect(tracked.get(1)).toEqual([2500, 2600])
      })
      expect(settled.get(1)).toEqual([2500, 2600])
    })
  })

  it('one point revived and another removed, the count unchanged', async () => {
    await withCopyInFlight(new Float32Array([1000, 1000, NaN, NaN, 1000, 3000, 3000, 3000]), [1, 2], async (simulation, read) => {
      simulation.setPointPositions(new Float32Array([1000, 1000, 2500, 2600, NaN, NaN, 3000, 3000]))
      simulation.applyData()
      expect([...read().keys()]).toEqual([])
      const settled = await readUntil(read, (tracked) => tracked.has(1), (tracked) => {
        expect(tracked.has(2)).toBe(false)
        if (tracked.has(1)) expect(tracked.get(1)).toEqual([2500, 2600])
      })
      expect([...settled.entries()]).toEqual([[1, [2500, 2600]]])
    })
  })

  it('no points left: every read is empty', async () => {
    await withCopyInFlight(POSITIONS, [0, 3], async (simulation, read) => {
      simulation.setPointPositions(new Float32Array(0))
      simulation.applyData()
      expect(read().size).toBe(0)
      await tick()
      expect(read().size).toBe(0)
    })
  })

  it('new coordinates for the same points keep the reads advancing', async () => {
    await withCopyInFlight(POSITIONS, [1], async (simulation, read) => {
      // An application that sends every frame its own layout: same points, new coordinates.
      // A copy in flight is still a copy of this point list.
      let latest = read().get(1)
      for (let i = 1; i <= 60 && latest?.[0] === 3000; i += 1) {
        const moved = new Float32Array(POSITIONS)
        moved[2] = 3000 + i
        simulation.setPointPositions(moved)
        simulation.applyData()
        await tick()
        latest = read().get(1)
      }
      expect(latest?.[0]).toBeGreaterThan(3000)
    })
  })
})

describe('non-blocking reads on a graph that owns a canvas', () => {
  /** A graph with nothing to animate: its render loop is idle unless something asks for a frame. */
  const createCanvasGraph = async (config: GraphConfig): Promise<{ graph: Graph; destroy: () => void }> => {
    const div = document.createElement('div')
    div.style.width = '200px'
    div.style.height = '200px'
    document.body.appendChild(div)
    const graph = new Graph(div, { ...SIMULATION_CONFIG, enableSimulation: false, fitViewOnInit: false, ...config })
    graph.setPointPositions(POSITIONS)
    graph.render()
    await graph.ready
    return { graph, destroy: (): void => { graph.destroy(); div.remove() } }
  }

  /** Moves point 0 and reads it without blocking until the read reports the move. */
  const readsCatchUp = async (graph: Graph): Promise<[number, number] | undefined> => {
    graph.trackPointPositionsByIndices([0])
    const start = graph.getPointPositions()
    expect(graph.getTrackedPointPositionsMap({ nonBlocking: true }).get(0)).toEqual([start[0], start[1]])
    graph.setPointPosition(0, 2222, 3333)
    // Let the frame the move asked for pass, so the loop is idle when the read comes
    for (let i = 0; i < 5; i += 1) await tick()
    let latest = graph.getTrackedPointPositionsMap({ nonBlocking: true }).get(0)
    // The read returns what it has: the move arrives with a later one
    expect(latest).toEqual([start[0], start[1]])
    for (let i = 0; i < 100 && latest?.[0] !== 2222; i += 1) {
      await tick()
      latest = graph.getTrackedPointPositionsMap({ nonBlocking: true }).get(0)
    }
    return latest
  }

  it('an idle render loop wakes for a read taken from a timer', async () => {
    const { graph, destroy } = await createCanvasGraph({})
    try {
      expect(await readsCatchUp(graph)).toEqual([2222, 3333])
    } finally {
      destroy()
    }
  })

  it('a copy issued by one frame and collected after the point list grew does not report the new point at the origin', async () => {
    const { graph, destroy } = await createCanvasGraph({ rescalePositions: false })
    const frame = (): Promise<void> => new Promise((resolve) => { requestAnimationFrame(() => resolve()) })
    try {
      graph.trackPointPositionsByIndices([0, 5])
      graph.getTrackedPointPositionsMap({ nonBlocking: true })
      graph.setPointPosition(0, 1500, 1500)
      for (let i = 0; i < 5; i += 1) await tick()
      // The read asks for a frame; the end of that frame issues a copy of the four points
      graph.getTrackedPointPositionsMap({ nonBlocking: true })
      await frame()
      graph.setPointPositions(new Float32Array([...POSITIONS, 500, 500, 700, 700]))
      graph.render()
      // Every frame from here on collects first: none may decode that copy under the new list
      for (let i = 0; i < 20; i += 1) {
        await frame()
        const point = graph.getTrackedPointPositionsMap({ nonBlocking: true }).get(5)
        if (point) expect(point).toEqual([700, 700])
      }
      expect(graph.getTrackedPointPositionsMap({ nonBlocking: true }).get(5)).toEqual([700, 700])
    } finally {
      destroy()
    }
  })

  it('without a render loop of its own the read needs no frame', async () => {
    const { graph, destroy } = await createCanvasGraph({ enableRenderLoop: false })
    try {
      expect(await readsCatchUp(graph)).toEqual([2222, 3333])
    } finally {
      destroy()
    }
  })
})

/**
 * A host sharing its device leaves its own GL state behind. These two settings
 * silently drop a draw, so a read that draws between steps must not inherit them.
 */
const HOST_STATES: [name: string, parameters: Record<string, unknown>][] = [
  ['a scissor', { scissorTest: true, scissor: [0, 0, 0, 0] }],
  ['a color mask', { colorMask: [false, false, false, false] }],
]

describe('reads between steps on a shared device', () => {
  for (const [name, parameters] of HOST_STATES) {
    const withSharedDevice = async (
      run: (simulation: GraphSimulation, leaveHostState: () => void) => void
    ): Promise<void> => {
      const canvas = document.createElement('canvas')
      const device = await luma.createDevice({ type: 'webgl', adapters: [webgl2Adapter], createCanvasContext: { canvas } })
      const simulation = new GraphSimulation(SIMULATION_CONFIG, Promise.resolve(device))
      simulation.setPointPositions(POSITIONS)
      simulation.setPointClusters([0, 0, 1, 1])
      simulation.applyData()
      await simulation.ready
      try {
        run(simulation, () => {
          (device as Device & { setParametersWebGL: (parameters: Record<string, unknown>) => void }).setParametersWebGL(parameters)
        })
      } finally {
        simulation.destroy()
        device.canvasContext?.destroy()
        device.destroy()
      }
    }

    it(`a new tracker reads its points when the host left ${name}`, async () => {
      await withSharedDevice((simulation, leaveHostState) => {
        for (let i = 0; i < 3; i += 1) simulation.step()
        const snapshot = simulation.getPointPositionsArray()
        leaveHostState()
        const tracker = simulation.trackPoints([0, 2])
        expect(tracker.positions().get(0)).toEqual([snapshot[0], snapshot[1]])
        expect(tracker.positions().get(2)).toEqual([snapshot[4], snapshot[5]])
      })
    })

    it(`a tracker given another set reads the new points when the host left ${name}`, async () => {
      await withSharedDevice((simulation, leaveHostState) => {
        const tracker = simulation.trackPoints([0])
        for (let i = 0; i < 3; i += 1) simulation.step()
        const snapshot = simulation.getPointPositionsArray()
        expect(tracker.positions().get(0)).toEqual([snapshot[0], snapshot[1]])
        leaveHostState()
        tracker.setIndices([1])
        expect(tracker.positions().get(1)).toEqual([snapshot[2], snapshot[3]])
      })
    })

    it(`a cluster read sees a point moved between steps when the host left ${name}`, async () => {
      await withSharedDevice((simulation, leaveHostState) => {
        for (let i = 0; i < 3; i += 1) simulation.step()
        simulation.pause()
        simulation.setPointPosition(0, 500, 500)
        const snapshot = simulation.getPointPositionsArray()
        leaveHostState()
        const clusters = simulation.getClusterPositions()
        expect(clusters[0]).toBeCloseTo(((snapshot[0] as number) + (snapshot[2] as number)) / 2, 1)
        expect(clusters[1]).toBeCloseTo(((snapshot[1] as number) + (snapshot[3] as number)) / 2, 1)
      })
    })
  }
})
