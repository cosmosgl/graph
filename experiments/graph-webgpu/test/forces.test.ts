import { describe, expect, it } from 'vitest'
import { GraphSimulation, type GraphSimulationConfig } from '../src'

const isolated: GraphSimulationConfig = {
  simulationGravity: 0,
  simulationCenter: 0,
  simulationRepulsion: 0,
  simulationLinkSpring: 0,
  simulationFriction: 1,
  rescalePositions: false,
  randomSeed: 3,
}

describe('WebGPU simulation forces', () => {
  it('applies weighted incoming and outgoing springs in sequence and updates weights without resetting positions', async () => {
    const sim = new GraphSimulation({
      ...isolated,
      simulationLinkSpring: 1,
      simulationLinkDistance: 2,
      simulationLinkDistRandomVariationRange: [1, 1],
    })
    try {
      sim.setPointPositions(new Float32Array([0, 0, 10, 0]))
      sim.setLinks(new Float32Array([0, 1]))
      sim.setLinkStrength(new Float32Array([0.25]))
      sim.applyData(1)
      await sim.ready
      sim.step()
      const xy = new Float32Array([2, 0, 8.5, 0])
      expect(await sim.getPointPositionsAsync()).toEqual(xy)
      sim.setLinkStrength(new Float32Array([0]))
      sim.applyData(1)
      sim.step()
      expect(await sim.getPointPositionsAsync()).toEqual(xy)
    } finally { sim.destroy() }
  })

  it('excludes absent slots from live centroids, applies per-point attraction weights and repels from a world-space cursor', async () => {
    const sim = new GraphSimulation({ ...isolated, simulationCluster: 0.5, simulationAttractor: 0 })
    try {
      sim.setPointPositions(new Float32Array([0, 0, 10, 0, NaN, NaN]))
      sim.setPinnedPoints([0])
      sim.setPointClusters([0, 0, 0])
      sim.setPointClusterStrength(new Float32Array([1, 1, 1]))
      sim.applyData(1)
      await sim.ready
      expect(await sim.getClusterPositionsAsync()).toEqual([5, 0])
      sim.step()
      expect(await sim.getPointPositionsAsync()).toEqual(new Float32Array([0, 0, 7.5, 0, NaN, NaN]))
      sim.setConfig({ simulationCluster: 0, simulationAttractor: 0.5 })
      sim.setPointAttractors(new Float32Array([NaN, NaN, 11.5, 0, NaN, NaN]))
      sim.setPointAttractorStrength(new Float32Array([1, 0.5, 1]))
      sim.applyData(1)
      sim.step()
      expect(await sim.getPointPositionsAsync()).toEqual(new Float32Array([0, 0, 8.5, 0, NaN, NaN]))
      sim.config.simulationRepulsionFromMouse = 10
      sim.pause()
      sim.applyMouseRepulsion(0, 0)
      expect(await sim.getPointPositionsAsync()).toEqual(new Float32Array([0, 0, 18.5, 0, NaN, NaN]))
      expect(await sim.getClusterPositionsAsync()).toEqual([9.25, 0])
    } finally { sim.destroy() }
  })

  it.each([3, 8192])('resolves the same pinned contact across two iterations at %i points', async count => {
    const sim = new GraphSimulation({
      ...isolated,
      simulationCollision: 1,
      simulationCollisionRadius: 5,
      simulationCollisionIterations: 2,
      simulationFriction: 0,
    })
    try {
      const xy = Float32Array.from({ length: count * 2 }, (_, i) => i % 2 === 0 ? i * 100 : 0)
      xy[2] = 2
      sim.setPointPositions(xy)
      sim.setPinnedPoints([0])
      sim.applyData(1)
      await sim.ready
      sim.step()
      expect(await sim.getPointPositionsByIndicesAsync([0, 1, 2])).toEqual(new Float32Array([0, 0, 8, 0, 400, 0]))
    } finally { sim.destroy() }
  })

  it('rebuilds large-graph repulsion from moving world bounds and preserves pins and absent slots', async () => {
    const sim = new GraphSimulation({ ...isolated, simulationRepulsion: 1 })
    try {
      const count = 10_000
      const input = Float32Array.from({ length: count * 2 }, (_, i) => 2000 + Math.sin(i * 1.313) * 200)
      const last = count - 1
      input.set([NaN, NaN], 2 * last)
      sim.setPointPositions(input)
      sim.setPinnedPoints([0])
      sim.applyData(1)
      await sim.ready
      sim.step()
      const xy = await sim.getPointPositionsAsync()
      expect(xy[0]).toBe(input[0])
      expect(xy[1]).toBe(input[1])
      expect(xy[8]).not.toBe(input[8])
      expect(xy.subarray(0, 2 * last).every(Number.isFinite)).toBe(true)
      expect(xy[2 * last]).toBeNaN()
      sim.setPointPosition(0, -10000, -10000)
      sim.step()
      expect((await sim.getBoundsAsync())?.slice(0, 2)).toEqual([-10000, -10000])
    } finally { sim.destroy() }
  })
})
