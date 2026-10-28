import { describe, it, expect, vi } from 'vitest'

import { Graph, type GraphConfig } from '@cosmos.gl/graph'
import { READBACK_WAIT_CAP_MS, READBACK_COLD_STEPS } from '@/graph/modules/Store'

/**
 * Frame pacing while a non-blocking readback is pending.
 *
 * A frame issues a fenced GPU copy for every `nonBlocking` read taken since the
 * last one, and a later frame collects it. The render loop must not queue another
 * frame while that copy's fence has not signaled: Chrome's `getBufferSubData`
 * waits behind every command queued before it, so a frame queued ahead of the
 * collect turns a non-blocking read into a stall, and the positions it returns
 * fall a frame further behind for every frame queued.
 *
 * The GPU here is far too fast to leave a fence open, so the tests hold every
 * fence by stubbing `clientWaitSync` to report `TIMEOUT_EXPIRED`. Frames are
 * observed through the simulation tick callback: a frame that runs steps the
 * simulation, a frame that is held does not.
 */

/** A simulation that keeps moving for the length of a test. */
const RUNNING_CONFIG: GraphConfig = {
  spaceSize: 4096,
  simulationGravity: 0.5,
  simulationRepulsion: 0.1,
  simulationLinkSpring: 0,
  simulationFriction: 0.7,
  simulationDecay: 1_000_000,
  fitViewOnInit: false,
}

/** Four points around the space center, none at equilibrium. */
const POSITIONS = new Float32Array([1000, 1000, 3000, 1000, 1000, 3000, 3000, 3000])

const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/** Every fence reports "not yet" until `release()`. */
const holdFences = (): (() => void) => {
  const spy = vi.spyOn(WebGL2RenderingContext.prototype, 'clientWaitSync')
    .mockReturnValue(WebGL2RenderingContext.TIMEOUT_EXPIRED)
  return (): void => { spy.mockRestore() }
}

/**
 * Resolves once a copy is in flight behind a held fence. Hover detection is throttled
 * and a copy is issued at a frame's end, so under load a fixed delay is not enough.
 */
const untilReadbackPending = async (graph: Graph): Promise<void> => {
  const { points, lines, simulation } = graph as unknown as {
    points: { hasPendingPickReadback: boolean; hasPendingTrackedReadback: boolean };
    lines: { hasPendingPickReadback: boolean };
    simulation: { hasPendingCentroidReadback: boolean };
  }
  const inFlight = (): boolean => points.hasPendingPickReadback || lines.hasPendingPickReadback ||
    points.hasPendingTrackedReadback || simulation.hasPendingCentroidReadback
  for (let i = 0; i < 200 && !inFlight(); i += 1) await wait(10)
  expect(inFlight()).toBe(true)
}

interface RunningGraph {
  graph: Graph;
  canvas: HTMLCanvasElement;
  /** Simulation ticks so far: one per frame that ran. */
  ticks: () => number;
  destroy: () => void;
}

const createRunningGraph = async (config: GraphConfig = {}, links?: Float32Array): Promise<RunningGraph> => {
  const div = document.createElement('div')
  div.style.width = '200px'
  div.style.height = '200px'
  document.body.appendChild(div)
  let ticks = 0
  const graph = new Graph(div, { ...RUNNING_CONFIG, ...config, onSimulationTick: (): void => { ticks += 1 } })
  graph.setPointPositions(POSITIONS)
  if (links) graph.setLinks(links)
  graph.render()
  await graph.ready
  const canvas = div.querySelector('canvas') as HTMLCanvasElement
  return {
    graph,
    canvas,
    ticks: (): number => ticks,
    destroy: (): void => { graph.destroy(); div.remove() },
  }
}

/**
 * Leaves a tracked-positions copy pending: the first read caches, the frames move
 * the points, the second read is behind and asks a frame for a copy, and that
 * frame's end issues it behind a held fence.
 */
const armTrackedReadback = async (graph: Graph): Promise<void> => {
  graph.trackPointPositionsByIndices([0])
  graph.getTrackedPointPositionsMap({ nonBlocking: true })
  await wait(60)
  graph.getTrackedPointPositionsMap({ nonBlocking: true })
  await untilReadbackPending(graph)
}

/** When the render loop began holding frames for the pending copy; 0 while it has not held one yet. */
const holdStartedAt = (graph: Graph): number => (graph as unknown as { readbackWaitStartedAt: number }).readbackWaitStartedAt

/**
 * Asserts that no frame ran over `ms`, then that frames resume once `release()` lets the
 * fence signal. The render loop gives a fence up after `READBACK_WAIT_CAP_MS` and runs the
 * frame: under load (every test file at once on a CI runner) the first held frame can lie
 * that far behind the end of the wait, and the frame that runs then is the cap's, not a
 * failure of the hold — so the hold is asserted only while the cap has not passed. The
 * start is taken before the wait: a frame that runs through a pending copy resets it.
 */
const expectHeldThenResumed = async (running: RunningGraph, release: () => void, ms = 150): Promise<void> => {
  const startedAt = holdStartedAt(running.graph) || performance.now()
  const before = running.ticks()
  await wait(ms)
  const after = running.ticks()
  if (performance.now() - startedAt < READBACK_WAIT_CAP_MS) expect(after).toBe(before)
  release()
  await wait(100)
  expect(running.ticks()).toBeGreaterThan(before)
}

describe('the render loop holds the next frame while a readback is pending', () => {
  it('a tracked-positions copy', async () => {
    const running = await createRunningGraph()
    let release = (): void => {}
    try {
      running.graph.trackPointPositionsByIndices([0])
      running.graph.getTrackedPointPositionsMap({ nonBlocking: true })
      await wait(60)
      release = holdFences()
      running.graph.getTrackedPointPositionsMap({ nonBlocking: true })
      await untilReadbackPending(running.graph)
      await expectHeldThenResumed(running, release)
    } finally {
      release()
      running.destroy()
    }
  })

  it('a cluster-centroid copy', async () => {
    const running = await createRunningGraph()
    let release = (): void => {}
    try {
      running.graph.setPointClusters([0, 0, 1, 1])
      running.graph.render()
      await running.graph.ready
      running.graph.getClusterPositions({ nonBlocking: true })
      await wait(60)
      release = holdFences()
      running.graph.getClusterPositions({ nonBlocking: true })
      await untilReadbackPending(running.graph)
      await expectHeldThenResumed(running, release)
    } finally {
      release()
      running.destroy()
    }
  })

  it('a hover pick', async () => {
    const running = await createRunningGraph()
    let release = (): void => {}
    try {
      await wait(60)
      release = holdFences()
      // The pointer lands on the canvas: hover detection issues a pick behind a fence
      running.canvas.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, isPrimary: true, pointerType: 'mouse', clientX: 100, clientY: 100,
      }))
      await untilReadbackPending(running.graph)
      await expectHeldThenResumed(running, release)
    } finally {
      release()
      running.destroy()
    }
  })

  it('a link hover pick, which lives on the renderer rather than the simulation', async () => {
    // Link hovering is on once a link handler is configured; one link joins points 0 and 1
    const running = await createRunningGraph({ onLinkMouseOver: (): void => {} }, new Float32Array([0, 1]))
    const original = WebGL2RenderingContext.prototype.clientWaitSync
    const spy = vi.spyOn(WebGL2RenderingContext.prototype, 'clientWaitSync').mockReturnValue(WebGL2RenderingContext.TIMEOUT_EXPIRED)
    try {
      await wait(60)
      running.canvas.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, isPrimary: true, pointerType: 'mouse', clientX: 100, clientY: 100,
      }))
      await untilReadbackPending(running.graph)
      // Hover detection issued a point pick and a link pick. Let every fence but the link
      // pick's signal: the hold must outlast the point pick.
      const { lines } = running.graph as unknown as { lines: { pickingReadback: { sync: WebGLSync | null } } }
      const linkSync = lines.pickingReadback.sync
      expect(linkSync).not.toBeNull()
      spy.mockImplementation(function (this: WebGL2RenderingContext, sync, flags, timeout) {
        return sync === linkSync ? WebGL2RenderingContext.TIMEOUT_EXPIRED : original.call(this, sync, flags, timeout)
      })
      await wait(60)
      await expectHeldThenResumed(running, () => spy.mockRestore())
    } finally {
      spy.mockRestore()
      running.destroy()
    }
  })

  it('a render request during the hold schedules no frame of its own', async () => {
    const running = await createRunningGraph()
    let release = (): void => {}
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    try {
      running.graph.trackPointPositionsByIndices([0])
      running.graph.getTrackedPointPositionsMap({ nonBlocking: true })
      await wait(60)
      release = holdFences()
      running.graph.getTrackedPointPositionsMap({ nonBlocking: true })
      await untilReadbackPending(running.graph)
      // From here the loop is held; a request must coalesce into the held frame
      raf.mockClear()
      running.graph.setPointPosition(0, 1500, 1500)
      await wait(100)
      expect(raf).not.toHaveBeenCalled()
      await expectHeldThenResumed(running, release)
    } finally {
      raf.mockRestore()
      release()
      running.destroy()
    }
  })

  it('a fence that never signals is given up on after the cap and the loop draws again', async () => {
    const running = await createRunningGraph()
    const release = holdFences()
    try {
      await armTrackedReadback(running.graph)
      const held = running.ticks()
      await wait(300)
      expect(running.ticks()).toBe(held)
      // Past the cap the pending copy is dropped, and with nobody reading, no new one is issued
      await wait(READBACK_WAIT_CAP_MS)
      const resumed = running.ticks()
      expect(resumed).toBeGreaterThan(held)
      await wait(150)
      expect(running.ticks()).toBeGreaterThan(resumed)
    } finally {
      release()
      running.destroy()
    }
  }, 10_000)
})

/**
 * These pin behavior that holds before and after the pacing: the hold must not
 * outlive the loop, and engines without a loop of their own are never paced.
 */
describe('the hold ends with the loop', () => {
  it('destroy() during the hold leaves no timer behind', async () => {
    const running = await createRunningGraph()
    const release = holdFences()
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    try {
      await armTrackedReadback(running.graph)
      running.destroy()
      raf.mockClear()
      release()
      await wait(100)
      expect(raf).not.toHaveBeenCalled()
    } finally {
      raf.mockRestore()
      release()
    }
  })

  it('turning the render loop off during the hold hands scheduling to the host at once', async () => {
    const running = await createRunningGraph()
    const release = holdFences()
    try {
      await armTrackedReadback(running.graph)
      running.graph.setConfigPartial({ enableRenderLoop: false })
      release()
      await wait(100)
      const before = running.ticks()
      running.graph.renderOneFrame()
      await wait(50)
      // Exactly the host's frame ran: nothing from the loop's timer
      expect(running.ticks()).toBe(before + 1)
    } finally {
      release()
      running.destroy()
    }
  })

  it('a headless graph steps whatever its fences say', async () => {
    const graph = new Graph(null, RUNNING_CONFIG)
    graph.setPointPositions(POSITIONS)
    graph.render()
    await graph.ready
    const release = holdFences()
    try {
      graph.trackPointPositionsByIndices([0])
      graph.getTrackedPointPositionsMap({ nonBlocking: true })
      const before = graph.getPointPositionsArray()
      for (let i = 0; i < 5; i += 1) graph.step()
      expect(graph.getPointPositionsArray()).not.toEqual(before)
    } finally {
      release()
      graph.destroy()
    }
  })
})

/**
 * A non-blocking read returns the latest copy. After a pause in reading that copy
 * predates the pause, and an overlay would appear where the points were and jump a
 * copy later. A read that comes long after the last one waits like a first read.
 */
describe('a non-blocking read after a pause in reading', () => {
  /** Lets steps run with nobody reading, counted in steps: the suite's frame rate varies. */
  const pauseReading = async (running: RunningGraph, steps = READBACK_COLD_STEPS + 3): Promise<void> => {
    const start = running.ticks()
    for (let i = 0; i < 500 && running.ticks() - start < steps; i += 1) await wait(10)
    expect(running.ticks() - start).toBeGreaterThanOrEqual(steps)
  }

  it('returns the current tracked positions, not the ones from before the pause', async () => {
    const running = await createRunningGraph()
    try {
      running.graph.trackPointPositionsByIndices([0])
      const stale = running.graph.getTrackedPointPositionsMap({ nonBlocking: true }).get(0)
      await pauseReading(running)
      // Same task, no frame between the two reads: a blocking read says where the point is now
      const resumed = running.graph.getTrackedPointPositionsMap({ nonBlocking: true }).get(0)
      const current = running.graph.getTrackedPointPositionsMap().get(0)
      expect(resumed).toEqual(current)
      expect(resumed).not.toEqual(stale)
    } finally {
      running.destroy()
    }
  })

  it('returns the current cluster centroids, not the ones from before the pause', async () => {
    const running = await createRunningGraph()
    try {
      running.graph.setPointClusters([0, 0, 1, 1])
      running.graph.render()
      await running.graph.ready
      const stale = [...running.graph.getClusterPositions({ nonBlocking: true })]
      await pauseReading(running)
      const resumed = [...running.graph.getClusterPositions({ nonBlocking: true })]
      const current = [...running.graph.getClusterPositions()]
      expect(resumed).toEqual(current)
      expect(resumed).not.toEqual(stale)
    } finally {
      running.destroy()
    }
  })

  it('a reader that keeps asking stays on the non-blocking path', async () => {
    const running = await createRunningGraph()
    // A read that waits ends in a synchronous readPixels into an array; the copies the
    // non-blocking path issues read into a buffer, by offset. Nothing else in these frames
    // reads pixels: no pointer is on the canvas.
    const readPixels = vi.spyOn(WebGL2RenderingContext.prototype, 'readPixels')
    const waitedReads = (): number => readPixels.mock.calls.filter((args) => typeof args[6] !== 'number').length
    try {
      running.graph.trackPointPositionsByIndices([0])
      running.graph.getTrackedPointPositionsMap({ nonBlocking: true })
      expect(waitedReads()).toBe(1) // the first read, with nothing earlier to return
      readPixels.mockClear()
      // One read after every step, for a dozen steps
      let reads = 0
      let lastTick = running.ticks()
      for (let i = 0; i < 300 && reads < 12; i += 1) {
        await wait(10)
        if (running.ticks() === lastTick) continue
        lastTick = running.ticks()
        running.graph.getTrackedPointPositionsMap({ nonBlocking: true })
        reads += 1
      }
      expect(reads).toBe(12)
      expect(waitedReads()).toBe(0)
    } finally {
      readPixels.mockRestore()
      running.destroy()
    }
  })

  it('a cluster reader that kept asking while nothing moved stays on the non-blocking path', async () => {
    const running = await createRunningGraph()
    try {
      running.graph.setPointClusters([0, 0, 1, 1])
      running.graph.render()
      await running.graph.ready
      running.graph.getClusterPositions({ nonBlocking: true })
      // A zoom with the simulation blocked, or a pause: no step runs, the centroids stay
      // current, and every read returns them from the up-to-date cache
      running.graph.pause()
      await wait(60)
      const still = [...running.graph.getClusterPositions({ nonBlocking: true })]
      for (let i = 0; i < 10; i += 1) {
        await wait(50)
        expect([...running.graph.getClusterPositions({ nonBlocking: true })]).toEqual(still)
      }
      // The points move again. The reader never paused, so the first read after the move
      // returns the cache — the still centroids — rather than waiting for the new ones
      running.graph.unpause()
      const before = running.ticks()
      for (let i = 0; i < 200 && running.ticks() === before; i += 1) await wait(5)
      const resumed = [...running.graph.getClusterPositions({ nonBlocking: true })]
      expect(resumed).toEqual(still)
      expect([...running.graph.getClusterPositions()]).not.toEqual(still)
    } finally {
      running.destroy()
    }
  })
})
