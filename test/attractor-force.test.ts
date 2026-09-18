import { describe, it, expect } from 'vitest'
import { Graph, GraphSimulation } from '@cosmos.gl/graph'

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
})
