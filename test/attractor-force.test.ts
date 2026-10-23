import { describe, it, expect, vi } from 'vitest'
import { Graph, GraphSimulation } from '@cosmos.gl/graph'
import type { ForceAttractor } from '@/graph/modules/ForceAttractor'

// The attractor branch predates GraphSimulation: both entry points must reach
// the force now owned by the composed simulation, including after recreation.
describe.each(['graph', 'simulation'] as const)('attractors through %s', kind => {
  it('applies targets and strengths, skips NaN targets, and survives recreation', async () => {
    const config = {
      rescalePositions: false,
      simulationGravity: 0,
      simulationRepulsion: 0,
      simulationLinkSpring: 0,
      simulationAttraction: 0.5,
      simulationFriction: 1,
    }
    const engine = kind === 'graph' ? new Graph(null, config) : new GraphSimulation(config)
    const apply = (): void => {
      if (engine instanceof Graph) engine.render()
      else engine.applyData()
    }
    engine.setPointPositions(new Float32Array([1000, 1000, 2000, 2000, 3000, 3000]))
    engine.setPointAttractors(new Float32Array([1200, 1000, NaN, NaN, 3200, 3000]))
    engine.setPointAttractorStrength(new Float32Array([1, 1, 0]))
    apply()
    await engine.ready
    try {
      engine.step()
      const positions = engine.getPointPositionsArray()
      expect(positions[0]).toBeGreaterThan(1000)
      expect(positions[0]).toBeLessThan(1200)
      expect(positions[2]).toBe(2000)
      expect(positions[4]).toBe(3000)

      if (engine instanceof Graph) {
        engine.setConfigPartial({ enableSimulation: false })
        engine.setConfigPartial({ enableSimulation: true })
      } else {
        engine.setConfig({ enableSimulation: false })
        engine.setConfig({ enableSimulation: true })
      }
      engine.setPointAttractorStrength(new Float32Array([0, 1, 1]))
      apply()
      engine.step()
      expect(engine.getPointPositionsArray()[4]).toBeGreaterThan(3000)
    } finally {
      engine.destroy()
    }
  })

  it('rejects non-finite targets, defaults invalid strengths, and skips empty target sets', async () => {
    const config = {
      rescalePositions: false,
      simulationGravity: 0,
      simulationRepulsion: 0,
      simulationLinkSpring: 0,
      simulationAttraction: 0.5,
      simulationFriction: 1,
    }
    const engine = kind === 'graph' ? new Graph(null, config) : new GraphSimulation(config)
    const apply = (): void => {
      if (engine instanceof Graph) engine.render()
      else engine.applyData()
    }
    const positions = new Float32Array([1000, 1000, 2000, 2000, 3000, 3000, 3500, 3500])
    const targets = new Float32Array([Infinity, 1000, 2000, -Infinity, 3200, 3000, 3700, 3500])
    const strengths = new Float32Array([1, 1, Infinity, -Infinity])
    engine.setPointPositions(positions)
    engine.setPointAttractors(targets)
    engine.setPointAttractorStrength(strengths)
    apply()
    await engine.ready
    try {
      engine.step()
      const result = engine.getPointPositionsArray()
      expect(Array.from(result.subarray(0, 4))).toEqual([1000, 1000, 2000, 2000])
      expect(result[4]).toBeGreaterThan(3000)
      expect(result[6]).toBeGreaterThan(3500)
      expect(Array.from(strengths)).toEqual([1, 1, Infinity, -Infinity])
      const simulation = engine instanceof Graph ? engine.simulation : engine
      const { forceAttractor } = simulation as unknown as { forceAttractor: ForceAttractor }
      expect(forceAttractor.isActive).toBe(true)
      const run = vi.spyOn(forceAttractor, 'run')
      engine.setPointAttractors(new Float32Array(8).fill(NaN))
      apply()
      expect(forceAttractor.isActive).toBe(false)
      engine.step()
      expect(run).not.toHaveBeenCalled()
      engine.setPointAttractors(targets)
      apply()
      expect(forceAttractor.isActive).toBe(true)
      engine.setPointAttractors(new Float32Array())
      apply()
      expect(forceAttractor.isActive).toBe(false)
    } finally {
      engine.destroy()
    }
  })

  it('follows a new point count: a stale array asks for nothing, a matching one reallocates the texture', async () => {
    const config = {
      rescalePositions: false,
      simulationGravity: 0,
      simulationRepulsion: 0,
      simulationLinkSpring: 0,
      simulationAttraction: 0.5,
      simulationFriction: 1,
    }
    const engine = kind === 'graph' ? new Graph(null, config) : new GraphSimulation(config)
    const apply = (): void => {
      if (engine instanceof Graph) engine.render()
      else engine.applyData()
    }
    engine.setPointPositions(new Float32Array([1000, 1000]))
    engine.setPointAttractors(new Float32Array([1200, 1000]))
    apply()
    await engine.ready
    try {
      const simulation = engine instanceof Graph ? engine.simulation : engine
      const { forceAttractor } = simulation as unknown as { forceAttractor: { isActive: boolean; attractorTexture: { width: number } } }
      expect(forceAttractor.isActive).toBe(true)
      const firstTexture = forceAttractor.attractorTexture
      // Five points on the same one-pair array: the channel is a length mismatch now, so no force
      engine.setPointPositions(new Float32Array([1000, 1000, 2000, 2000, 3000, 3000, 4000, 4000, 500, 500]))
      apply()
      expect(forceAttractor.isActive).toBe(false)
      engine.step()
      expect(engine.getPointPositionsArray()[0]).toBe(1000)
      // A matching array brings the force back on a texture sized for the new count
      engine.setPointAttractors(new Float32Array([1200, 1000, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN]))
      apply()
      expect(forceAttractor.isActive).toBe(true)
      expect(forceAttractor.attractorTexture).not.toBe(firstTexture)
      expect(forceAttractor.attractorTexture.width).toBeGreaterThan(firstTexture.width)
      // Alpha has decayed a little over the earlier step, so the pull is just under 100
      engine.step()
      expect(engine.getPointPositionsArray()[0]).toBeGreaterThan(1090)
      expect(engine.getPointPositionsArray()[0]).toBeLessThan(1100.5)
      expect(engine.getPointPositionsArray()[2]).toBe(2000)
    } finally {
      engine.destroy()
    }
  })

  it.each(['spaceSize', 'enableSimulation'] as const)('applies attractors pending before %s changes', async change => {
    const config = {
      spaceSize: 2048,
      enableSimulation: change !== 'enableSimulation',
      rescalePositions: false,
      simulationGravity: 0,
      simulationRepulsion: 0,
      simulationLinkSpring: 0,
      simulationAttraction: 0.5,
      simulationFriction: 1,
    }
    const engine = kind === 'graph' ? new Graph(null, config) : new GraphSimulation(config)
    const apply = (): void => {
      if (engine instanceof Graph) engine.render()
      else engine.applyData()
    }
    engine.setPointPositions(new Float32Array([1000, 1000]))
    apply()
    await engine.ready
    try {
      engine.setPointAttractors(new Float32Array([1200, 1000]))
      engine.setPointAttractorStrength(new Float32Array([0.5]))
      const update = change === 'spaceSize' ? { spaceSize: 4096 } : { enableSimulation: true }
      if (engine instanceof Graph) engine.setConfigPartial(update)
      else engine.setConfig(update)
      apply()
      engine.step()
      expect(engine.getPointPositionsArray()[0]).toBeCloseTo(1050, 3)
    } finally {
      engine.destroy()
    }
  })
})
