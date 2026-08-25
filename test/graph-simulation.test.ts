import { describe, it, expect, vi } from 'vitest'
import { luma, type Device } from '@luma.gl/core'
import { webgl2Adapter } from '@luma.gl/webgl'

import { GraphSimulation, type GraphSimulationConfig } from '@cosmos.gl/graph'

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
      simulation.setPointPinned(0, true)
      simulation.setPointPosition(0, 3500, 3500)
      for (let i = 0; i < 30; i += 1) simulation.step()
      const positions = simulation.getPointPositionsArray()
      expect(positions[0]).toBeCloseTo(3500, 3)
      expect(positions[1]).toBeCloseTo(3500, 3)
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
        simulation.setPointPinned(0, true)
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
})
