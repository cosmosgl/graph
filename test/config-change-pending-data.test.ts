import { describe, it, expect } from 'vitest'
import { luma, type Device } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { Graph, GraphSimulation, type GraphConfig } from '@cosmos.gl/graph'

/**
 * A per-element setter followed by a config change that rebuilds the graph, then
 * `render()`: the new data must reach the GPU. The rebuild runs before `render()`
 * resolves the pending inputs, and it spends the update flags.
 */

/** One pixel per space unit under a 200 × 200 target; (1000, 1000) lands at (100, 100). */
const CONFIG: GraphConfig = {
  spaceSize: 2048,
  pixelRatio: 1,
  enableSimulation: false,
  rescalePositions: false,
  pointDefaultSize: 20,
}
const RED = [255, 0, 0, 255]

const createScene = async (): Promise<{
  graph: Graph;
  pixelAt: (spaceSize: number, x: number, y: number) => number[];
  destroy: () => void;
}> => {
  const canvas = document.createElement('canvas')
  const device: Device = await luma.createDevice({ type: 'webgl', adapters: [webgl2Adapter], createCanvasContext: { canvas } })
  const graph = new Graph(null, CONFIG, Promise.resolve(device))
  graph.setPointPositions(new Float32Array([1000, 1000]))
  graph.render()
  await graph.ready
  const target = device.createTexture({ format: 'rgba8unorm', width: 200, height: 200 })
  const framebuffer = device.createFramebuffer({ width: 200, height: 200, colorAttachments: [target] })
  const pixelAt = (spaceSize: number, x: number, y: number): number[] => {
    // setViewTransform's formula, inverted for k = 1 and (1000, 1000) → (100, 100)
    graph.setViewTransform({ k: 1, x: 100 - (1000 + (200 - spaceSize) / 2), y: 100 - ((spaceSize - 1000) + (200 - spaceSize) / 2) }, [200, 200])
    expect(graph.spaceToScreenPosition([1000, 1000])).toEqual([100, 100])
    const renderPass = device.beginRenderPass({ framebuffer, clearColor: [0, 0, 0, 0] })
    graph.drawToRenderPass(renderPass)
    renderPass.end()
    device.submit()
    const pixels = device.readPixelsToArrayWebGL(framebuffer) as Uint8Array
    // GL reads rows bottom-up
    const offset = ((199 - y) * 200 + x) * 4
    return Array.from(pixels.subarray(offset, offset + 4))
  }
  const destroy = (): void => {
    graph.destroy()
    framebuffer.destroy()
    target.destroy()
    device.canvasContext?.destroy()
    device.destroy()
  }
  return { graph, pixelAt, destroy }
}

describe('a config change with data pending', () => {
  it('uploads colors set before a spaceSize change on the next render', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      expect(pixelAt(2048, 100, 100)).not.toEqual(RED)
      graph.setPointColors(new Float32Array([1, 0, 0, 1]))
      // Rebuilds the graph before render() has resolved the new colors
      graph.setConfigPartial({ spaceSize: 4096 })
      graph.render()
      expect(pixelAt(4096, 100, 100)).toEqual(RED)
    } finally {
      destroy()
    }
  })

  it('sizes the textures for points added before a spaceSize change', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      // A second point, fifty units right: the position texture has to grow for it
      graph.setPointPositions(new Float32Array([1000, 1000, 1050, 1000]))
      graph.setConfigPartial({ spaceSize: 4096 })
      graph.render()
      expect(pixelAt(4096, 100, 100)[3]).toBe(255)
      expect(pixelAt(4096, 150, 100)[3]).toBe(255)
    } finally {
      destroy()
    }
  })

  it('uploads colors set before the simulation is switched on', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      graph.setPointColors(new Float32Array([1, 0, 0, 1]))
      // Enabling the simulation rebuilds the graph by its own path, without render()
      graph.setConfigPartial({ enableSimulation: true })
      graph.render()
      expect(pixelAt(2048, 100, 100)).toEqual(RED)
    } finally {
      destroy()
    }
  })

  it('sizes the textures for points added before the simulation is switched on', async () => {
    const { graph, pixelAt, destroy } = await createScene()
    try {
      graph.setPointPositions(new Float32Array([1000, 1000, 1050, 1000]))
      graph.setConfigPartial({ enableSimulation: true })
      graph.render()
      expect(pixelAt(2048, 100, 100)[3]).toBe(255)
      expect(pixelAt(2048, 150, 100)[3]).toBe(255)
    } finally {
      destroy()
    }
  })

  it('standalone: reads back points added before the simulation is switched on', async () => {
    const simulation = new GraphSimulation({ spaceSize: 2048, rescalePositions: false, enableSimulation: false })
    simulation.setPointPositions(new Float32Array([1000, 1000]))
    simulation.applyData()
    await simulation.ready
    try {
      simulation.setPointPositions(new Float32Array([1000, 1000, 1050, 1000]))
      simulation.setConfig({ spaceSize: 2048, rescalePositions: false, enableSimulation: true })
      expect(Array.from(simulation.getPointPositionsArray())).toEqual([1000, 1000, 1050, 1000])
    } finally {
      simulation.destroy()
    }
  })

  it('standalone: reads back points added before a spaceSize change', async () => {
    const simulation = new GraphSimulation({ spaceSize: 2048, rescalePositions: false })
    simulation.setPointPositions(new Float32Array([1000, 1000]))
    simulation.applyData()
    await simulation.ready
    try {
      simulation.setPointPositions(new Float32Array([1000, 1000, 1050, 1000]))
      // Rebuilds through the config path, before any applyData() has resolved the points
      simulation.setConfig({ spaceSize: 4096, rescalePositions: false })
      expect(Array.from(simulation.getPointPositionsArray())).toEqual([1000, 1000, 1050, 1000])
    } finally {
      simulation.destroy()
    }
  })
})

/** Forces tuned so a few steps produce visible movement, from the host-embedding tests. */
const FORCES: GraphConfig = {
  spaceSize: 4096,
  simulationGravity: 0.5,
  simulationRepulsion: 0.1,
  simulationLinkSpring: 0,
  simulationFriction: 0.7,
  simulationDecay: 5000,
}
const FOUR_POINTS = new Float32Array([1000, 1000, 3000, 1000, 1000, 3000, 3000, 3000])

const createRunningSimulation = async (): Promise<GraphSimulation> => {
  const simulation = new GraphSimulation(FORCES)
  simulation.setPointPositions(FOUR_POINTS)
  simulation.applyData()
  await simulation.ready
  return simulation
}

/**
 * These pin behavior that already holds: a rebuild mid-run leaves the trajectory
 * alone, and a new layout set mid-run moves as a fresh one does.
 */
describe('a rebuild while the simulation runs', () => {
  it('a rebuild with nothing pending does not change the trajectory', async () => {
    const straight = await createRunningSimulation()
    const rebuilt = await createRunningSimulation()
    try {
      for (let i = 0; i < 5; i += 1) straight.step()
      for (let i = 0; i < 3; i += 1) rebuilt.step()
      rebuilt.applyData()
      for (let i = 0; i < 2; i += 1) rebuilt.step()
      expect(Array.from(rebuilt.getPointPositionsArray())).toEqual(Array.from(straight.getPointPositionsArray()))
    } finally {
      straight.destroy()
      rebuilt.destroy()
    }
  })

  it('graph: a render() with colors pending does not change the trajectory', async () => {
    const createGraph = async (): Promise<Graph> => {
      const graph = new Graph(null, FORCES)
      graph.setPointPositions(FOUR_POINTS)
      graph.render()
      await graph.ready
      return graph
    }
    const straight = await createGraph()
    const rendered = await createGraph()
    try {
      for (let i = 0; i < 5; i += 1) straight.step()
      for (let i = 0; i < 3; i += 1) rendered.step()
      rendered.setPointColors(new Float32Array(FOUR_POINTS.length * 2).fill(1))
      rendered.render()
      for (let i = 0; i < 2; i += 1) rendered.step()
      expect(Array.from(rendered.getPointPositionsArray())).toEqual(Array.from(straight.getPointPositionsArray()))
    } finally {
      straight.destroy()
      rendered.destroy()
    }
  })

  it('starts a new layout from rest: positions set mid-run move as a fresh layout does', async () => {
    const fresh = await createRunningSimulation()
    const reset = await createRunningSimulation()
    try {
      for (let i = 0; i < 3; i += 1) reset.step()
      reset.setPointPositions(new Float32Array(FOUR_POINTS))
      reset.applyData(1)
      fresh.step()
      reset.step()
      expect(Array.from(reset.getPointPositionsArray())).toEqual(Array.from(fresh.getPointPositionsArray()))
    } finally {
      fresh.destroy()
      reset.destroy()
    }
  })
})

/**
 * A rebuild outside render() must snap pending positions. In a graph with a canvas the
 * default 800 ms transition is armed, so a config-change rebuild would otherwise upload the
 * positions in animate mode and start nothing; a render(undefined, 0) afterwards then clears
 * the queue without ever writing the new positions into the drawn textures.
 */
describe('a config change with positions pending, in a graph that animates', () => {
  const wait = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

  const createScene = async (): Promise<{ graph: Graph; div: HTMLDivElement }> => {
    const div = document.createElement('div')
    div.style.width = '200px'
    div.style.height = '200px'
    document.body.appendChild(div)
    // Not headless, transitionDuration left at its 800 ms default
    const graph = new Graph(div, { spaceSize: 2048, enableSimulation: false, rescalePositions: false, fitViewOnInit: false })
    graph.setPointPositions(new Float32Array([1000, 1000]))
    graph.render(undefined, 0)
    await graph.ready
    await wait(50)
    return { graph, div }
  }

  it('a moved point snaps at the spaceSize change and stays there through a snapping render', async () => {
    const { graph, div } = await createScene()
    try {
      graph.setPointPositions(new Float32Array([1200, 1200]))
      graph.setConfigPartial({ spaceSize: 4096 })
      // Applied at the config change, without animation
      expect(Array.from(graph.getPointPositionsArray())).toEqual([1200, 1200])
      graph.render(undefined, 0)
      await wait(50)
      expect(Array.from(graph.getPointPositionsArray())).toEqual([1200, 1200])
    } finally {
      graph.destroy()
      div.remove()
    }
  })

  it('a moved point and an added point both land when the count changes', async () => {
    const { graph, div } = await createScene()
    try {
      graph.setPointPositions(new Float32Array([1200, 1200, 1050, 1000]))
      graph.setConfigPartial({ spaceSize: 4096 })
      graph.render(undefined, 0)
      await wait(50)
      expect(Array.from(graph.getPointPositionsArray())).toEqual([1200, 1200, 1050, 1000])
    } finally {
      graph.destroy()
      div.remove()
    }
  })

  it('an animated render after the config change has nothing left to animate', async () => {
    const { graph, div } = await createScene()
    try {
      graph.setPointPositions(new Float32Array([1200, 1200]))
      graph.setConfigPartial({ spaceSize: 4096 })
      graph.render()
      await wait(50)
      // Already at the target: no interpolation is in flight
      expect(Array.from(graph.getPointPositionsArray())).toEqual([1200, 1200])
    } finally {
      graph.destroy()
      div.remove()
    }
  })
})
