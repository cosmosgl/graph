import { describe, it, expect, vi } from 'vitest'
import { luma, type Device, type Texture } from '@luma.gl/core'
import { webgl2Adapter, WebGLStateTracker } from '@luma.gl/webgl'

import { GraphSimulation, type GraphSimulationConfig } from '@cosmos.gl/graph'
import { readPixels } from '@/graph/helper'
import type { ForceLink } from '@/graph/modules/ForceLink'

/**
 * Standalone `GraphSimulation` contract tests: the extracted simulation class
 * must uphold the same behavior the headless `Graph` tests verify — with no
 * `Graph`, no canvas, and no rendering anywhere in the picture.
 */

const SIMULATION_CONFIG: GraphSimulationConfig = {
  spaceSize: 4096,
  simulationGravity: 0.5,
  simulationRepulsion: 0.1,
  simulationLinkSpring: 2,
  simulationLinkDistance: 10,
  simulationFriction: 0.7,
  simulationDecay: 5000,
}

const POSITIONS = new Float32Array([1000, 1000, 3000, 1000, 1000, 3000, 3000, 3000])

const createSimulation = async (
  config: GraphSimulationConfig = SIMULATION_CONFIG,
  positions: Float32Array = POSITIONS,
  devicePromise?: Promise<Device>
): Promise<GraphSimulation> => {
  const simulation = new GraphSimulation(config, devicePromise)
  simulation.setPointPositions(positions)
  simulation.applyData()
  await simulation.ready
  return simulation
}

describe('GraphSimulation', () => {
  it('ingests data, steps, and reads back positions without a Graph', async () => {
    const simulation = await createSimulation()
    try {
      const before = simulation.getPointPositionsArray()
      expect(before.length).toBe(POSITIONS.length)
      for (let i = 0; i < 20; i += 1) simulation.step()
      const after = simulation.getPointPositionsArray()
      let moved = 0
      for (let i = 0; i < POSITIONS.length / 2; i += 1) {
        if (Math.hypot((after[i * 2] as number) - (before[i * 2] as number), (after[i * 2 + 1] as number) - (before[i * 2 + 1] as number)) > 1) moved += 1
      }
      expect(moved).toBe(POSITIONS.length / 2)
    } finally {
      simulation.destroy()
    }
  })

  it('collision separates a pile of overlapping points, with every other force off', async () => {
    // 60 points of size 10 seeded inside a 4-unit disc: every pair overlaps deeply.
    const n = 60
    const positions = new Float32Array(n * 2)
    for (let i = 0; i < n; i += 1) {
      const angle = i * 2.399963
      const radius = 2 * Math.sqrt((i + 1) / n)
      positions[i * 2] = 2048 + Math.cos(angle) * radius
      positions[i * 2 + 1] = 2048 + Math.sin(angle) * radius
    }
    const padding = 0.5
    const contact = 2 * (10 / 2 + padding)
    const overlappingPairs = (pos: Float32Array): number => {
      let count = 0
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          const d = Math.hypot((pos[i * 2] as number) - (pos[j * 2] as number), (pos[i * 2 + 1] as number) - (pos[j * 2 + 1] as number))
          if (d < contact - 0.1) count += 1 // allow ~1% settling slack
        }
      }
      return count
    }
    const simulation = await createSimulation({
      ...SIMULATION_CONFIG,
      simulationGravity: 0,
      simulationRepulsion: 0,
      simulationLinkSpring: 0,
      pointDefaultSize: 10,
      simulationCollision: 1,
      simulationCollisionPadding: padding,
      simulationCollisionIterations: 2,
    }, positions)
    try {
      expect(overlappingPairs(simulation.getPointPositionsArray())).toBeGreaterThan(1000)
      for (let i = 0; i < 60; i += 1) simulation.step()
      expect(overlappingPairs(simulation.getPointPositionsArray())).toBe(0)
    } finally {
      simulation.destroy()
    }
  })

  it('collision separates piles above the all-pairs threshold (depth-peeled slot path)', async () => {
    // 4,200 points — above the 4,096 all-pairs threshold — as 42 piles of 100
    // size-10 points, each pile seeded inside a 4-unit disc. The piles sit far
    // apart, so only pairs within a pile can ever overlap.
    const piles = 42
    const perPile = 100
    const n = piles * perPile
    const positions = new Float32Array(n * 2)
    for (let p = 0; p < piles; p += 1) {
      const cx = 400 + (p % 7) * 500
      const cy = 400 + Math.floor(p / 7) * 500
      for (let i = 0; i < perPile; i += 1) {
        const angle = i * 2.399963
        const radius = 2 * Math.sqrt((i + 1) / perPile)
        positions[(p * perPile + i) * 2] = cx + Math.cos(angle) * radius
        positions[(p * perPile + i) * 2 + 1] = cy + Math.sin(angle) * radius
      }
    }
    const contact = 2 * (10 / 2 + 0.5)
    const overlappingPairs = (pos: Float32Array): number => {
      let count = 0
      for (let p = 0; p < piles; p += 1) {
        for (let i = p * perPile; i < (p + 1) * perPile; i += 1) {
          for (let j = i + 1; j < (p + 1) * perPile; j += 1) {
            const d = Math.hypot((pos[i * 2] as number) - (pos[j * 2] as number), (pos[i * 2 + 1] as number) - (pos[j * 2 + 1] as number))
            if (d < contact - 0.1) count += 1
          }
        }
      }
      return count
    }
    const simulation = await createSimulation({
      ...SIMULATION_CONFIG,
      simulationGravity: 0,
      simulationRepulsion: 0,
      simulationLinkSpring: 0,
      pointDefaultSize: 10,
      simulationCollision: 1,
      simulationCollisionPadding: 0.5,
      simulationCollisionIterations: 2,
    }, positions)
    try {
      expect(overlappingPairs(simulation.getPointPositionsArray())).toBeGreaterThan(100000)
      for (let i = 0; i < 100; i += 1) simulation.step()
      expect(overlappingPairs(simulation.getPointPositionsArray())).toBe(0)
    } finally {
      simulation.destroy()
    }
  })

  it('simulationCollisionCooling scales the collision correction by alpha', async () => {
    // Two size-10 points overlapping by 8 of their 10-unit contact distance, nothing else on.
    const positions = new Float32Array([2048, 2048, 2050, 2048])
    const distance = (pos: Float32Array): number => Math.hypot((pos[2] as number) - (pos[0] as number), (pos[3] as number) - (pos[1] as number))
    const base: GraphSimulationConfig = {
      ...SIMULATION_CONFIG,
      simulationGravity: 0,
      simulationRepulsion: 0,
      simulationLinkSpring: 0,
      pointDefaultSize: 10,
      simulationCollision: 1,
    }
    const settle = async (cooling: number): Promise<number> => {
      const simulation = await createSimulation({ ...base, simulationCollisionCooling: cooling }, positions)
      try {
        // A nearly cooled simulation: alpha 0.01
        simulation.start(0.01)
        for (let i = 0; i < 20; i += 1) simulation.step()
        return distance(simulation.getPointPositionsArray())
      } finally {
        simulation.destroy()
      }
    }
    // Cooling 0: full strength regardless of alpha — the pair is projected to contact.
    expect(await settle(0)).toBeGreaterThan(9.5)
    // Cooling 1: the correction is scaled by alpha, so at 0.01 the pair barely moves.
    expect(await settle(1)).toBeLessThan(4)
  })

  it('floors a link\'s rest length at the contact distance while collision is on', async () => {
    // Two size-20 points (contact distance 20) joined by a spring asking for 1 unit.
    const positions = new Float32Array([2000, 2048, 2100, 2048])
    const distance = (pos: Float32Array): number => Math.hypot((pos[2] as number) - (pos[0] as number), (pos[3] as number) - (pos[1] as number))
    const base: GraphSimulationConfig = {
      ...SIMULATION_CONFIG,
      simulationGravity: 0,
      simulationRepulsion: 0,
      simulationLinkSpring: 1,
      simulationLinkDistance: 1,
      simulationLinkDistRandomVariationRange: [1, 1],
      pointDefaultSize: 20,
    }
    const settle = async (config: GraphSimulationConfig): Promise<number> => {
      const simulation = await createSimulation(config, positions)
      try {
        simulation.setLinks(new Float32Array([0, 1]))
        simulation.applyData()
        for (let i = 0; i < 150; i += 1) simulation.step()
        return distance(simulation.getPointPositionsArray())
      } finally {
        simulation.destroy()
      }
    }
    // Without collision the spring closes to its 1-unit rest length …
    expect(await settle({ ...base, simulationCollision: 0 })).toBeLessThan(3)
    // … with collision on, the rest length is floored at contact and the pair settles touching.
    // Strength 0.2 closes only a fifth of an overlap per tick, so collision alone could not
    // restore contact against the spring each tick: only the floor keeps the pair at 20.
    const withCollision = await settle({ ...base, simulationCollision: 0.2 })
    expect(withCollision).toBeGreaterThan(19)
    expect(withCollision).toBeLessThan(21.5)
  })

  it('applies links through setLinks + applyData and pulls linked points together', async () => {
    const simulation = await createSimulation({ ...SIMULATION_CONFIG, simulationGravity: 0, simulationRepulsion: 0 })
    try {
      simulation.setLinks(new Float32Array([0, 1]))
      simulation.applyData()
      const before = simulation.getPointPositionsArray()
      const distanceBefore = Math.hypot((before[2] as number) - (before[0] as number), (before[3] as number) - (before[1] as number))
      for (let i = 0; i < 30; i += 1) simulation.step()
      const after = simulation.getPointPositionsArray()
      const distanceAfter = Math.hypot((after[2] as number) - (after[0] as number), (after[3] as number) - (after[1] as number))
      expect(distanceAfter).toBeLessThan(distanceBefore)
    } finally {
      simulation.destroy()
    }
  })

  it('runs the simulation lifecycle: start reheats, pause suspends, step ends it', async () => {
    const onSimulationEnd = vi.fn()
    const onSimulationPause = vi.fn()
    const simulation = await createSimulation({ ...SIMULATION_CONFIG, simulationDecay: 50, onSimulationEnd, onSimulationPause })
    try {
      simulation.pause()
      expect(simulation.isSimulationRunning).toBe(false)
      expect(onSimulationPause).toHaveBeenCalledTimes(1)

      simulation.start(1)
      expect(simulation.isSimulationRunning).toBe(true)

      let steps = 0
      while (simulation.isSimulationRunning && steps < 2000) {
        simulation.step()
        steps += 1
      }
      expect(simulation.isSimulationRunning).toBe(false)
      expect(onSimulationEnd).toHaveBeenCalledTimes(1)
      expect(simulation.progress).toBe(1)
    } finally {
      simulation.destroy()
    }
  })

  it('keeps a stop() issued before ready — setup must not flip it back to running', async () => {
    const simulation = new GraphSimulation(SIMULATION_CONFIG)
    simulation.setPointPositions(POSITIONS)
    simulation.applyData()
    simulation.stop()
    await simulation.ready
    try {
      expect(simulation.isSimulationRunning).toBe(false)
      expect(simulation.progress).toBe(0)
      // A later start still works as usual
      simulation.start(1)
      expect(simulation.isSimulationRunning).toBe(true)
    } finally {
      simulation.destroy()
    }
  })

  it('exposes the position texture with the version contract', async () => {
    const simulation = await createSimulation()
    try {
      const info = simulation.getPointPositionTexture()
      expect(info).toBeDefined()
      expect(info!.pointCount).toBe(4)
      expect(info!.textureSize).toBe(2)
      simulation.step()
      expect(simulation.getPointPositionTexture()!.version).toBeGreaterThan(info!.version)
    } finally {
      simulation.destroy()
    }
  })

  it('pins and sparse-moves points', async () => {
    const simulation = await createSimulation()
    try {
      simulation.setPinnedPoint(0, true)
      simulation.setPointPosition(0, 3500, 3500)
      for (let i = 0; i < 30; i += 1) simulation.step()
      const positions = simulation.getPointPositionsArray()
      expect(positions[0]).toBeCloseTo(3500, 3)
      expect(positions[1]).toBeCloseTo(3500, 3)
    } finally {
      simulation.destroy()
    }
  })

  it('keeps declarative pins: an index beyond the point count pins its point when the count grows', async () => {
    const simulation = await createSimulation()
    try {
      simulation.setPinnedPoint(5, true) // only 4 points exist yet
      expect(simulation.isPointPinned(5)).toBe(true)

      const grown = new Float32Array([...POSITIONS, 500, 500, 2000, 2000])
      simulation.setPointPositions(grown)
      simulation.applyData()
      const before = simulation.getPointPositionsArray()
      for (let i = 0; i < 20; i += 1) simulation.step()
      const after = simulation.getPointPositionsArray()
      // point 5 froze where it was; its unpinned neighbor moved
      expect(after[10]).toBeCloseTo(before[10] as number, 3)
      expect(after[11]).toBeCloseTo(before[11] as number, 3)
      expect(Math.hypot((after[8] as number) - (before[8] as number), (after[9] as number) - (before[9] as number))).toBeGreaterThan(1)
    } finally {
      simulation.destroy()
    }
  })

  it('sanitizes the pinned set and reads it back: impossible entries drop, future ones stay', async () => {
    const simulation = await createSimulation()
    try {
      simulation.setPinnedPoints([3, -1, 2.5, 99, 3])
      expect(simulation.isPointPinned(3)).toBe(true)
      expect(simulation.isPointPinned(99)).toBe(true)
      expect(simulation.isPointPinned(-1)).toBe(false)
      expect(simulation.isPointPinned(2.5)).toBe(false)
      expect(simulation.isPointPinned(2)).toBe(false)
      simulation.setPinnedPoint(99, false)
      expect(simulation.isPointPinned(99)).toBe(false)
      expect(simulation.isPointPinned(3)).toBe(true)
      simulation.setPinnedPoints(null)
      expect(simulation.isPointPinned(3)).toBe(false)
    } finally {
      simulation.destroy()
    }
  })

  it('setConfig toggles enableSimulation with the module lifecycle', async () => {
    const onSimulationEnd = vi.fn()
    const simulation = await createSimulation({ ...SIMULATION_CONFIG, onSimulationEnd })
    try {
      simulation.setConfig({ enableSimulation: false })
      expect(simulation.isSimulationRunning).toBe(false)
      expect(onSimulationEnd).toHaveBeenCalledTimes(1)
      const frozen = simulation.getPointPositionsArray()
      simulation.step() // must be a no-op with the simulation disabled
      expect(Array.from(simulation.getPointPositionsArray())).toEqual(Array.from(frozen))

      simulation.setConfig({ enableSimulation: true })
      expect(simulation.isSimulationRunning).toBe(true)
      simulation.step()
      const after = simulation.getPointPositionsArray()
      expect(Array.from(after)).not.toEqual(Array.from(frozen))
    } finally {
      simulation.destroy()
    }
  })

  it('shares an external device without owning it', async () => {
    const canvas = document.createElement('canvas')
    const device = await luma.createDevice({
      type: 'webgl',
      adapters: [webgl2Adapter],
      createCanvasContext: { canvas },
    })
    try {
      const simulation = await createSimulation(SIMULATION_CONFIG, POSITIONS, Promise.resolve(device))
      try {
        // Host state must not corrupt the simulation (the ambient-GL-state contract)
        const gl = (device as Device & { gl: WebGL2RenderingContext }).gl
        gl.enable(gl.BLEND)
        gl.enable(gl.DEPTH_TEST)
        simulation.setPinnedPoint(0, true)
        simulation.setPointPosition(0, 3500, 3500)
        for (let i = 0; i < 5; i += 1) simulation.step()
        const positions = simulation.getPointPositionsArray()
        expect(positions[0]).toBeCloseTo(3500, 3)
      } finally {
        simulation.destroy()
      }
      const gl = (device as Device & { gl: WebGL2RenderingContext }).gl
      expect(gl.isContextLost()).toBe(false)
    } finally {
      device.canvasContext?.destroy()
      device.destroy()
    }
  })

  it('hands an external device back in the state its host left it in', async () => {
    const canvas = document.createElement('canvas')
    const device = await luma.createDevice({
      type: 'webgl',
      adapters: [webgl2Adapter],
      createCanvasContext: { canvas },
    })
    try {
      const simulation = await createSimulation(SIMULATION_CONFIG, POSITIONS, Promise.resolve(device))
      try {
        // deck.gl sets this once, when it creates the device, and its layers draw on it
        // without declaring it: whatever cosmos changes, the host must find as it left it
        const gl = (device as Device & { gl: WebGL2RenderingContext }).gl
        gl.enable(gl.BLEND)
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        gl.enable(gl.DEPTH_TEST)
        gl.depthFunc(gl.LEQUAL)
        // No pipeline parameter covers these two, so only the wrapper's reset keeps them
        // off cosmos's writes: an empty scissor box and a closed mask would drop every one
        gl.enable(gl.SCISSOR_TEST)
        gl.scissor(0, 0, 0, 0)
        gl.colorMask(false, false, false, false)
        const expectHostState = (): void => {
          expect(gl.isEnabled(gl.BLEND)).toBe(true)
          expect(gl.getParameter(gl.BLEND_SRC_RGB)).toBe(gl.SRC_ALPHA)
          expect(gl.getParameter(gl.BLEND_DST_RGB)).toBe(gl.ONE_MINUS_SRC_ALPHA)
          expect(gl.isEnabled(gl.DEPTH_TEST)).toBe(true)
          expect(gl.getParameter(gl.DEPTH_FUNC)).toBe(gl.LEQUAL)
          expect(gl.isEnabled(gl.SCISSOR_TEST)).toBe(true)
          expect(Array.from(gl.getParameter(gl.SCISSOR_BOX) as Int32Array)).toEqual([0, 0, 0, 0])
          expect(gl.getParameter(gl.COLOR_WRITEMASK)).toEqual([false, false, false, false])
        }

        // Every entry point that runs a pass between the host's draws
        const before = simulation.getPointPositionsArray()
        simulation.step()
        expect(simulation.getPointPositionsArray()).not.toEqual(before)
        expectHostState()
        simulation.setPointPositionsByIndices([0], [3500, 3500])
        expectHostState()
        const tracker = simulation.trackPoints([1, 2])
        tracker.positions()
        expectHostState()
        tracker.destroy()
        simulation.setPointClusters([0, 0, 1, 1])
        simulation.applyData()
        expect(simulation.getClusterPositions().length).toBe(4)
        expectHostState()
      } finally {
        simulation.destroy()
      }
    } finally {
      device.canvasContext?.destroy()
      device.destroy()
    }
  })

  it('hands the host its state back when a pass throws before it ends', async () => {
    const canvas = document.createElement('canvas')
    const device = await luma.createDevice({
      type: 'webgl',
      adapters: [webgl2Adapter],
      createCanvasContext: { canvas },
    })
    try {
      const simulation = await createSimulation(SIMULATION_CONFIG, POSITIONS, Promise.resolve(device))
      try {
        const gl = (device as Device & { gl: WebGL2RenderingContext }).gl
        gl.enable(gl.BLEND)
        // luma keeps one stack of state frames per context. A render pass pushes its own
        // frame on top of the wrapper's, so a throw before the pass ends leaves two frames
        // up: the wrapper must pop back to where it started, not once
        const tracker = WebGLStateTracker.get(gl)
        const depth = tracker.stateStack.length
        expect(() => simulation.withExternalDeviceState(() => {
          device.beginRenderPass({})
          throw new Error('pass failed')
        })).toThrow('pass failed')
        expect(gl.isEnabled(gl.BLEND)).toBe(true)
        expect(tracker.stateStack.length).toBe(depth)
      } finally {
        simulation.destroy()
      }
    } finally {
      device.canvasContext?.destroy()
      device.destroy()
    }
  })
})

const PACKING_POSITIONS = new Float32Array([1000, 1000, 1010, 1000, 1000, 1010, 1020, 1010, 1010, 1020, 1030, 1000])
// The hub crosses texture rows; duplicates, a self-link and invalid endpoints
// exercise adjacency compaction without changing the original strength indices.
const PACKING_LINKS = new Float32Array([
  0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 1, 0, 0, 0, 2, 0, 3,
  0, 4, 0, 5, 1, 0, 2, 0, 5, 1, -1, 0, 0, 99, 0.5, 1,
])
const PACKING_STRENGTHS = new Float32Array([0, 0.25, 1, 4, NaN, -1, 0.5, 2, 0, 1, 0.25, 4, 1, 0.25, 0.5, NaN, -1])
const PACKING_CONFIG: GraphSimulationConfig = {
  randomSeed: 22477733,
  rescalePositions: false,
  simulationRepulsion: 0,
  simulationGravity: 0,
  simulationCenter: 0,
  simulationCollision: 0,
  simulationLinkSpring: 0.4,
  simulationLinkDistance: 20,
  simulationLinkDistRandomVariationRange: [0.3, 1.7],
}
const FORCE_DIRECTIONS = ['forceLinkIncoming', 'forceLinkOutgoing'] as const

// Reference spring velocities captured before packing, at 53fb462. Keep these
// independent of the packing code and GLSL arithmetic being tested.
const PACKING_REFERENCE = [
  {
    count: 6,
    velocities: [
      [0.69861758, 0.03775049, 0.04713783, 0, 0, -0.62852716, 0, 0, 0, 0, -0.12800725, 0],
      [-0.01347524, -0.00534759, -0.27108422, 0, 0, -0.06177985, 0.05303014, 0.02651507, 0.07968595, 0.15937190, -0.28692260, 0],
    ],
  },
  {
    count: 3,
    velocities: [
      [-0.00478214, -0.01583116, 0.04407719, 0, 0, -0.35855359],
      [-0.01654259, -0.00826448, 0.01272400, 0, 0, 0.04222088],
    ],
  },
]

const getLinkForces = (simulation: GraphSimulation): ForceLink[] => FORCE_DIRECTIONS.map(name => Reflect.get(simulation, name) as ForceLink)

const getLinkTextures = (force: ForceLink): Texture[] => [
  Reflect.get(force, 'neighborAndSpringTexture') as Texture,
  Reflect.get(force, 'randomDistanceTexture') as Texture,
]

const applyPackingFixture = (simulation: GraphSimulation, count = 6): void => {
  simulation.store.addRandomSeed(22477733)
  simulation.setPointPositions(PACKING_POSITIONS.subarray(0, count * 2), true)
  simulation.setLinks(PACKING_LINKS)
  simulation.setLinkStrength(PACKING_STRENGTHS)
  simulation.applyData()
  simulation.store.alpha = 0.75
}

const expectSpringVelocities = (simulation: GraphSimulation, expected: number[][]): void => {
  getLinkForces(simulation).forEach((force, direction) => {
    force.run()
    const pixels = readPixels(simulation.device!, simulation.points!.velocityFbo!)
    const velocities = expected[direction]!
    velocities.forEach((value, index) => {
      expect(pixels[Math.floor(index / 2) * 4 + index % 2]).toBeCloseTo(value, 4)
    })
  })
}

describe('packed link-force textures', () => {
  it.each(PACKING_REFERENCE)('preserves pre-packing spring velocities with $count points', async ({ count, velocities }) => {
    const simulation = new GraphSimulation(PACKING_CONFIG)
    await simulation.ready
    try {
      applyPackingFixture(simulation, count)
      expectSpringVelocities(simulation, velocities)
    } finally {
      simulation.destroy()
    }
  })

  it('uses one texel per input link and reuses or replaces both directional textures at square boundaries', async () => {
    const simulation = new GraphSimulation(PACKING_CONFIG)
    await simulation.ready
    let previous: Texture[][] | undefined
    let previousSide = 0
    try {
      simulation.setPointPositions(PACKING_POSITIONS, true)
      for (const count of [1, 4, 5, 9, 10, 16, 17, 26, 17]) {
        simulation.setLinks(new Float32Array(Array.from({ length: count }, () => [0, 1]).flat()))
        simulation.applyData()
        const side = Math.ceil(Math.sqrt(count))
        expect(simulation.store.linksTextureSize).toBe(side)
        const current = getLinkForces(simulation).map(getLinkTextures)
        current.forEach((textures, direction) => {
          textures.forEach((texture, channel) => {
            expect(texture.width).toBe(side)
            expect(texture.height).toBe(side)
            expect(texture.format).toBe(channel === 0 ? 'rgba32float' : 'r32float')
            expect(texture.destroyed).toBe(false)
            if (previous) {
              const old = previous[direction]![channel]!
              if (side === previousSide) expect(texture).toBe(old)
              else {
                expect(texture).not.toBe(old)
                expect(old.destroyed).toBe(true)
              }
            }
          })
        })
        previous = current
        previousSide = side
      }
    } finally {
      simulation.destroy()
    }
    previous!.flat().forEach(texture => expect(texture.destroyed).toBe(true))
  })

  it('refreshes packed strengths and adjacency after zeroing, shrinking, clearing and restoring', async () => {
    const simulation = new GraphSimulation(PACKING_CONFIG)
    await simulation.ready
    try {
      applyPackingFixture(simulation)
      const originalTextures = getLinkForces(simulation).map(getLinkTextures)
      simulation.setLinkStrength(new Float32Array(PACKING_STRENGTHS.length))
      simulation.applyData()
      expectSpringVelocities(simulation, [Array(12).fill(0), Array(12).fill(0)])
      getLinkForces(simulation).forEach((force, direction) => {
        getLinkTextures(force).forEach((texture, channel) => expect(texture).toBe(originalTextures[direction]![channel]))
      })

      applyPackingFixture(simulation, 3)
      expectSpringVelocities(simulation, PACKING_REFERENCE[1]!.velocities)
      simulation.setLinks(new Float32Array())
      simulation.applyData()
      expect(simulation.store.linksTextureSize).toBe(0)
      const before = simulation.getPointPositionsArray().slice()
      simulation.step()
      expect(simulation.getPointPositionsArray()).toEqual(before)

      simulation.setPointPositions(new Float32Array(), true)
      simulation.applyData()
      expect(simulation.store.pointsTextureSize).toBe(0)
      expect(() => simulation.step()).not.toThrow()

      applyPackingFixture(simulation)
      expectSpringVelocities(simulation, PACKING_REFERENCE[0]!.velocities)
    } finally {
      simulation.destroy()
    }
  })
})
