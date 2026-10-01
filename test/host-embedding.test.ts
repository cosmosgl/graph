import { describe, it, expect, vi } from 'vitest'
import { luma, type Device } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { Graph, type GraphConfig } from '@cosmos.gl/graph'

/**
 * Host-embedding contract tests. Everything runs headless (`new Graph(null, …)`)
 * on a real WebGL 2 context (headless Chromium / SwiftShader): the simulation is
 * driven with `step()`, results are read through the snapshot and texture APIs.
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

const createHeadlessGraph = async (
  config: GraphConfig = SIMULATION_CONFIG,
  positions: Float32Array = POSITIONS,
  devicePromise?: Promise<Device>
): Promise<Graph> => {
  const graph = new Graph(null, config, devicePromise)
  graph.setPointPositions(positions)
  graph.render()
  await graph.ready
  return graph
}

const createExternalDevice = async (): Promise<{ device: Device; destroy: () => void }> => {
  const canvas = document.createElement('canvas')
  const device = await luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: { canvas },
  })
  return {
    device,
    destroy: (): void => {
      device.canvasContext?.destroy()
      device.destroy()
    },
  }
}

describe('headless lifecycle', () => {
  it('simulates without a div and without an internal render loop', async () => {
    const graph = await createHeadlessGraph()
    try {
      const before = graph.getPointPositionsArray()
      expect(before.length).toBe(POSITIONS.length)
      for (let i = 0; i < 20; i += 1) graph.step()
      const after = graph.getPointPositionsArray()
      let moved = 0
      for (let i = 0; i < POSITIONS.length / 2; i += 1) {
        if (Math.hypot((after[i * 2] as number) - (before[i * 2] as number), (after[i * 2 + 1] as number) - (before[i * 2 + 1] as number)) > 1) moved += 1
      }
      expect(moved).toBe(POSITIONS.length / 2)
      for (const value of after) {
        expect(Number.isFinite(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(4096)
      }
    } finally {
      graph.destroy()
    }
  })

  it('fires onSimulationEnd from step() — no render loop performs the alpha-floor check', async () => {
    const onSimulationEnd = vi.fn()
    const graph = await createHeadlessGraph({ ...SIMULATION_CONFIG, simulationDecay: 50, onSimulationEnd })
    try {
      let steps = 0
      while (graph.isSimulationRunning && steps < 2000) {
        graph.step()
        steps += 1
      }
      expect(graph.isSimulationRunning).toBe(false)
      expect(onSimulationEnd).toHaveBeenCalledTimes(1)
      expect(graph.progress).toBe(1)
    } finally {
      graph.destroy()
    }
  })
})

describe('position snapshots', () => {
  it('getPointPositionsArray matches getPointPositions and reuses a provided destination', async () => {
    const graph = await createHeadlessGraph()
    try {
      const asNumbers = graph.getPointPositions()
      const asArray = graph.getPointPositionsArray()
      expect(Array.from(asArray)).toEqual(asNumbers)

      const out = new Float32Array(POSITIONS.length)
      const reused = graph.getPointPositionsArray(out)
      expect(reused).toBe(out)
      expect(Array.from(reused)).toEqual(asNumbers)
    } finally {
      graph.destroy()
    }
  })

  it('getPointPositionsAsync resolves the same values without stalling semantics changes', async () => {
    const graph = await createHeadlessGraph()
    try {
      graph.step()
      const sync = graph.getPointPositionsArray()
      const async = await graph.getPointPositionsAsync()
      expect(Array.from(async)).toEqual(Array.from(sync))
    } finally {
      graph.destroy()
    }
  })

  it('getPointPositionsAsync reads only after a GPU fence has signaled', async () => {
    const { device, destroy } = await createExternalDevice()
    const graph = await createHeadlessGraph(SIMULATION_CONFIG, POSITIONS, Promise.resolve(device))
    // Hold the fence: the read must wait for it instead of racing ahead to
    // the blocking getBufferSubData
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const createFence = vi.spyOn(device, 'createFence').mockReturnValue({
      signaled: held,
      destroy: vi.fn(),
      isSignaled: () => false,
    } as unknown as ReturnType<Device['createFence']>)
    try {
      graph.step()
      const expected = Array.from(graph.getPointPositionsArray())
      let settled = false
      const snapshot = graph.getPointPositionsAsync().then((positions) => { settled = true; return positions })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(createFence).toHaveBeenCalledTimes(1)
      expect(settled).toBe(false)

      release()
      expect(Array.from(await snapshot)).toEqual(expected)
    } finally {
      createFence.mockRestore()
      graph.destroy()
      destroy()
    }
  })

  it('getPointPositionsAsync returns empty when the point count changed mid-flight, texture size or not', async () => {
    // Four points: a 2×2 texture
    const graph = await createHeadlessGraph()
    try {
      graph.step()
      const snapshot = graph.getPointPositionsAsync()
      // Three points still fit the 2×2 texture: only the count tells the datasets apart
      graph.setPointPositions(new Float32Array([1000, 1000, 3000, 1000, 1000, 3000]))
      graph.render()
      expect((await snapshot).length).toBe(0)
      // The next read describes the new dataset
      expect((await graph.getPointPositionsAsync()).length).toBe(6)
    } finally {
      graph.destroy()
    }
  })

  it('an absent (NaN) point reads back as NaN, not as a frozen coordinate', async () => {
    const positions = new Float32Array([1000, 1000, NaN, NaN, 3000, 3000])
    const graph = await createHeadlessGraph(SIMULATION_CONFIG, positions)
    try {
      graph.step()
      const snapshot = graph.getPointPositionsArray()
      expect(Number.isNaN(snapshot[2])).toBe(true)
      expect(Number.isNaN(snapshot[3])).toBe(true)
      expect(Number.isFinite(snapshot[0])).toBe(true)
      expect(Number.isFinite(snapshot[4])).toBe(true)
    } finally {
      graph.destroy()
    }
  })
})

describe('position texture', () => {
  it('exposes size, count, and a version that advances with the simulation', async () => {
    const graph = await createHeadlessGraph()
    try {
      const info = graph.getPointPositionTexture()
      expect(info).toBeDefined()
      expect(info!.pointCount).toBe(4)
      expect(info!.textureSize).toBe(Math.ceil(Math.sqrt(4)))
      expect(info!.texture.width).toBe(info!.textureSize)

      graph.step()
      const next = graph.getPointPositionTexture()
      expect(next!.version).toBeGreaterThan(info!.version)
    } finally {
      graph.destroy()
    }
  })

  it('is undefined before data is rendered', () => {
    const graph = new Graph(null, SIMULATION_CONFIG)
    try {
      expect(graph.getPointPositionTexture()).toBeUndefined()
    } finally {
      graph.destroy()
    }
  })
})

describe('sparse updates and pinning', () => {
  it('setPointPosition moves a point immediately and skips absent points', async () => {
    const positions = new Float32Array([1000, 1000, NaN, NaN, 3000, 3000])
    const graph = await createHeadlessGraph(SIMULATION_CONFIG, positions)
    try {
      graph.setPointPosition(0, 2000, 2100)
      const snapshot = graph.getPointPositionsArray()
      expect(snapshot[0]).toBe(2000)
      expect(snapshot[1]).toBe(2100)

      // An absent point is not a valid target: it must stay absent
      graph.setPointPosition(1, 500, 500)
      const after = graph.getPointPositionsArray()
      expect(Number.isNaN(after[2])).toBe(true)
      expect(Number.isNaN(after[3])).toBe(true)
    } finally {
      graph.destroy()
    }
  })

  it('rejects a mismatched indices/positions pair without touching anything', async () => {
    const graph = await createHeadlessGraph()
    try {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const before = graph.getPointPositions()
      graph.setPointPositionsByIndices([0, 1], [1, 2])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(graph.getPointPositions()).toEqual(before)
      warn.mockRestore()
    } finally {
      graph.destroy()
    }
  })

  it('a pinned point holds its position through simulation steps; unpinning releases it', async () => {
    const graph = await createHeadlessGraph()
    try {
      graph.setPinnedPoint(0, true)
      expect(graph.isPointPinned(0)).toBe(true)
      graph.setPointPosition(0, 3500, 3500)
      for (let i = 0; i < 30; i += 1) graph.step()
      const pinned = graph.getPointPositionsArray()
      expect(pinned[0]).toBeCloseTo(3500, 3)
      expect(pinned[1]).toBeCloseTo(3500, 3)

      graph.setPinnedPoint(0, false)
      expect(graph.isPointPinned(0)).toBe(false)
      for (let i = 0; i < 30; i += 1) graph.step()
      const released = graph.getPointPositionsArray()
      const distance = Math.hypot((released[0] as number) - 3500, (released[1] as number) - 3500)
      expect(distance).toBeGreaterThan(1)
    } finally {
      graph.destroy()
    }
  })
})

describe('host view injection', () => {
  it('setViewTransform drives spaceToScreenPosition by the documented formula', async () => {
    const graph = await createHeadlessGraph()
    try {
      const k = 2
      const x = 10
      const y = 20
      const w = 800
      const h = 600
      const S = 4096
      graph.setViewTransform({ k, x, y }, [w, h])

      const [screenX, screenY] = graph.spaceToScreenPosition([100, 100])
      expect(screenX).toBeCloseTo(k * (100 + (w - S) / 2) + x, 3)
      expect(screenY).toBeCloseTo(k * ((S - 100) + (h - S) / 2) + y, 3)
      expect(graph.getZoomLevel()).toBe(k)
    } finally {
      graph.destroy()
    }
  })
})

describe('external device', () => {
  it('survives host GL state: blending and depth left enabled must not corrupt the simulation', async () => {
    const { device, destroy } = await createExternalDevice()
    try {
      const graph = await createHeadlessGraph(SIMULATION_CONFIG, POSITIONS, Promise.resolve(device))
      try {
        // A host (e.g. deck.gl) leaves its draw state behind between frames.
        // Blended writes into the RGBA32F position textures (texels carry
        // alpha 0) would zero the simulation without the state reset.
        const gl = (device as Device & { gl: WebGL2RenderingContext }).gl
        gl.enable(gl.BLEND)
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        gl.enable(gl.DEPTH_TEST)

        graph.setPinnedPoint(0, true)
        graph.setPointPosition(0, 3500, 3500)
        for (let i = 0; i < 5; i += 1) graph.step()

        const snapshot = graph.getPointPositionsArray()
        // The regression this guards: the pinned, sparse-moved point snapped
        // back and every position decayed toward zero under host blend state
        expect(snapshot[0]).toBeCloseTo(3500, 3)
        expect(snapshot[1]).toBeCloseTo(3500, 3)
        for (let i = 1; i < 4; i += 1) {
          expect(Number.isFinite(snapshot[i * 2])).toBe(true)
          expect(snapshot[i * 2]).toBeGreaterThan(0)
        }
      } finally {
        graph.destroy()
      }
      // Graph must not have destroyed the externally owned device
      const gl = (device as Device & { gl: WebGL2RenderingContext }).gl
      expect(gl.isContextLost()).toBe(false)
    } finally {
      destroy()
    }
  })
})

describe('external frame scheduling', () => {
  it('enableRenderLoop: false + renderOneFrame drives a canvas-owning graph to completion', async () => {
    const div = document.createElement('div')
    div.style.width = '200px'
    div.style.height = '200px'
    document.body.appendChild(div)
    const onSimulationEnd = vi.fn()
    const graph = new Graph(div, {
      ...SIMULATION_CONFIG,
      simulationDecay: 50,
      enableRenderLoop: false,
      fitViewOnInit: false,
      onSimulationEnd,
    })
    graph.setPointPositions(POSITIONS)
    graph.render()
    await graph.ready
    try {
      let frames = 0
      while (graph.isSimulationRunning && frames < 2000) {
        graph.renderOneFrame()
        frames += 1
      }
      expect(graph.isSimulationRunning).toBe(false)
      expect(onSimulationEnd).toHaveBeenCalledTimes(1)
    } finally {
      graph.destroy()
      div.remove()
    }
  })
})

/**
 * A position transition redraws the live texture from its source and target
 * every frame, so a sparse write has to reach those two as well. These run on
 * a graph that owns a canvas: a headless one snaps and has no transition.
 */
describe('sparse writes during a position transition', () => {
  const MOVED = new Float32Array([1500, 1000, 3500, 1000, 1500, 3000, 3500, 3000])
  const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

  const withAnimatedGraph = async (
    config: GraphConfig,
    run: (graph: Graph, transitionEnded: (count?: number) => Promise<boolean | undefined>) => Promise<void>
  ): Promise<void> => {
    const div = document.createElement('div')
    div.style.width = '200px'
    div.style.height = '200px'
    document.body.appendChild(div)
    const endings: boolean[] = []
    const graph = new Graph(div, {
      spaceSize: 4096,
      enableSimulation: false,
      fitViewOnInit: false,
      rescalePositions: false,
      ...config,
      onTransitionEnd: (interrupted: boolean): void => {
        endings.push(interrupted)
        config.onTransitionEnd?.(interrupted)
      },
    })
    graph.setPointPositions(POSITIONS)
    graph.render()
    await graph.ready
    await wait(100)
    try {
      // Resolves with the `count`-th ending: `false` for a completion, `true` for an interruption
      await run(graph, async (count = 1) => {
        for (let i = 0; i < 100 && endings.length < count; i += 1) await wait(30)
        return endings[count - 1]
      })
    } finally {
      graph.destroy()
      div.remove()
    }
  }
  const pointAt = (graph: Graph, index: number): [number, number] => {
    const positions = graph.getPointPositions()
    return [positions[index * 2] as number, positions[index * 2 + 1] as number]
  }

  it('a point moved mid-transition stays where it was put, and the others finish', async () => {
    await withAnimatedGraph({}, async (graph, transitionEnded) => {
      graph.setPointPositions(MOVED)
      graph.render(undefined, 400)
      await wait(120)
      graph.setPointPosition(0, 2222, 3333)
      expect(pointAt(graph, 0)).toEqual([2222, 3333])
      // The next frames blend source and target again: the write must be in both
      await wait(80)
      expect(pointAt(graph, 0)).toEqual([2222, 3333])

      expect(await transitionEnded()).toBe(false)
      expect(pointAt(graph, 0)).toEqual([2222, 3333])
      expect(pointAt(graph, 1)).toEqual([3500, 1000])
      expect(pointAt(graph, 3)).toEqual([3500, 3000])
    })
  })

  it('a point moved from the onTransition callback stays too', async () => {
    let graphInCallback: Graph | undefined
    let hasMoved = false
    await withAnimatedGraph({
      onTransition: (): void => {
        if (hasMoved || !graphInCallback) return
        hasMoved = true
        // This frame has already decided to blend: the blend must reproduce the write
        graphInCallback.setPointPosition(1, 2500, 2600)
      },
    }, async (graph, transitionEnded) => {
      graphInCallback = graph
      graph.setPointPositions(MOVED)
      graph.render(undefined, 400)
      expect(await transitionEnded()).toBe(false)
      expect(hasMoved).toBe(true)
      expect(pointAt(graph, 1)).toEqual([2500, 2600])
      expect(pointAt(graph, 0)).toEqual([1500, 1000])
    })
  })

  it('a point moved from onSimulationPause, which render() fires before the transition starts, stays', async () => {
    let graphInCallback: Graph | undefined
    let pauses = 0
    await withAnimatedGraph({
      ...SIMULATION_CONFIG,
      enableSimulation: true,
      onSimulationPause: (): void => {
        pauses += 1
        // The textures of the coming transition are built, the cycle is not active yet
        graphInCallback?.setPointPosition(0, 2222, 3333)
      },
    }, async (graph, transitionEnded) => {
      graphInCallback = graph
      expect(graph.isSimulationRunning).toBe(true)
      graph.setPointPositions(MOVED)
      graph.render(undefined, 400)
      // A position transition pauses a running simulation: the callback has run
      expect(pauses).toBe(1)
      expect(await transitionEnded()).toBe(false)
      expect(pointAt(graph, 0)).toEqual([2222, 3333])
      expect(pointAt(graph, 1)).toEqual([3500, 1000])
    })
  })

  it('a point moved from onTransitionEnd(true), when a new cycle interrupts the old one, stays', async () => {
    const LATER = new Float32Array([1500, 1400, 3500, 1400, 1500, 3400, 3500, 3400])
    let graphInCallback: Graph | undefined
    let interruptions = 0
    await withAnimatedGraph({
      onTransitionEnd: (interrupted: boolean): void => {
        if (!interrupted) return
        interruptions += 1
        // The old cycle is cleared, the new one is queued with its textures in place
        graphInCallback?.setPointPosition(0, 2222, 3333)
      },
    }, async (graph, transitionEnded) => {
      graphInCallback = graph
      graph.setPointPositions(MOVED)
      graph.render(undefined, 600)
      await wait(120)
      graph.setPointPositions(LATER)
      graph.render(undefined, 300)
      // The first ending is the interruption; the second is the new cycle completing
      expect(await transitionEnded(1)).toBe(true)
      expect(interruptions).toBe(1)
      expect(await transitionEnded(2)).toBe(false)
      expect(pointAt(graph, 0)).toEqual([2222, 3333])
      expect(pointAt(graph, 1)).toEqual([3500, 1400])
    })
  })

  it('a point that is fading out is not brought back by a write', async () => {
    await withAnimatedGraph({}, async (graph, transitionEnded) => {
      graph.setPointPositions(new Float32Array([1500, 1000, 3500, 1000, NaN, NaN, 3500, 3000]))
      graph.render(undefined, 400)
      await wait(120)
      graph.setPointPosition(2, 2222, 3333)
      expect(await transitionEnded()).toBe(false)
      expect(Number.isNaN(pointAt(graph, 2)[0])).toBe(true)
      expect(pointAt(graph, 1)).toEqual([3500, 1000])
    })
  })

  it('a point moved between setPointPositions and render ends on the new data', async () => {
    await withAnimatedGraph({}, async (graph, transitionEnded) => {
      graph.setPointPositions(MOVED)
      // The data update is applied by render(), after this write: it wins
      graph.setPointPosition(0, 2222, 3333)
      graph.render(undefined, 400)
      expect(await transitionEnded()).toBe(false)
      expect(pointAt(graph, 0)).toEqual([1500, 1000])
    })
  })
})
