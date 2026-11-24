import { luma } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { describe, expect, it } from 'vitest'
import { GraphSimulation, type GraphSimulationConfig } from '../src'
import { createNearField } from '../src/modules/ForceManyBody/near-field'
import { upload } from '../src/modules/Shared/compute'
import { resourceScope } from '../src/modules/Shared/resource-scope'

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
  it('resamples dense cells by seed, excludes self and adds exact sparse neighbors to the far force', async () => {
    const device = await luma.createDevice({ type: 'webgpu', adapters: [webgpuAdapter], waitForPageLoad: false })
    const scope = resourceScope()
    const positionsX = [10, 11, 13, 15, 18, 25]
    const count = positionsX.length
    try {
      const buffer = (values: Uint32Array | Float32Array): ReturnType<typeof upload> => scope.own(upload(device, values))
      const near = scope.own(createNearField(device, count))
      const positions = buffer(Float32Array.from(positionsX.flatMap(x => [x, 12, 0, 0])))
      const samples = buffer(new Float32Array(count * 2))
      // Width 8, cell size 8: four points in cell (1,1), one in (2,1) and one outside the near field.
      const heads = new Uint32Array(64)
      heads.set([4, 5, 6], 9)
      const counts = new Float32Array(64 * 4)
      for (const cell of [9, 10, 11]) counts[cell * 4 + 2] = cell === 9 ? 4 : 1
      const grid = {
        heads: buffer(heads),
        next: buffer(Uint32Array.of(0, 1, 2, 3, 0, 0)),
        cells: buffer(counts),
        box: buffer(Float32Array.of(0, 0, 64, 1 / 64)),
      }
      const initial = new Float32Array(count * 4)
      initial[0] = 0.25
      const forces = buffer(initial)
      async function firstForce (seed: number, slots: number): Promise<number> {
        forces.write(initial)
        const pass = device.beginComputePass()
        near.encode(pass, positions, grid, samples, forces, 1, 1, 8, seed, slots)
        pass.end()
        device.submit()
        const bytes = await forces.readAsync()
        return new DataView(bytes.buffer, bytes.byteOffset).getFloat32(0, true)
      }
      // The reference's lowbias32 order selects IDs 1,3 at seed 1/8, and IDs 0,2 at 1/4.
      const sparseAndFar = -1 / 8 + initial[0]
      expect(await firstForce(1 / 8, 2)).toBeCloseTo(sparseAndFar - 3 / 2 * (1 + 1 / 5), 5)
      expect(await firstForce(1 / 4, 2)).toBeCloseTo(sparseAndFar - 3 * (1 / 3), 5)
      expect(await firstForce(1 / 4, 4)).toBeCloseTo(sparseAndFar - (1 + 1 / 3 + 1 / 5), 5)
    } finally { scope.destroy(); device.destroy() }
  })

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
