import { describe, it, expect } from 'vitest'

import { GraphSimulation } from '@cosmos.gl/graph'

/**
 * Near-field repulsion sampling above 4,096 points: the `simulationRepulsionSamples`
 * contract (a positive integer fixes the per-cell sample count, applied on the
 * next tick; anything else is rejected) and the automatic count, which starts at
 * the floor and rises once the first occupancy measurement of a dense layout
 * lands. The count is read through the simulation's many-body module, the only
 * place it exists.
 */

const POINTS = 12_000

/**
 * Twelve tight discs of 1,000 points. The grid follows the data, so the finest
 * cells divide the span of the disc centres (~2,300 units into 256 per axis, about
 * 9 units a cell) and a 25-unit disc packs about 50 points into each of its cells —
 * far above the 8-slot floor.
 */
const clusteredPositions = (): Float32Array => {
  const positions = new Float32Array(POINTS * 2)
  let seed = 12345
  const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < POINTS; i += 1) {
    const cluster = i % 12
    const angle = random() * Math.PI * 2
    const radius = Math.sqrt(random()) * 25
    positions[i * 2] = 1024 + (cluster % 4) * 700 + Math.cos(angle) * radius
    positions[i * 2 + 1] = 1024 + Math.floor(cluster / 4) * 700 + Math.sin(angle) * radius
  }
  return positions
}

const slotCount = (simulation: GraphSimulation): number | undefined =>
  (simulation as unknown as { forceManyBody?: { nearField?: { count: number } } }).forceManyBody?.nearField?.count

const createSimulation = async (samples?: number): Promise<GraphSimulation> => {
  const simulation = new GraphSimulation({
    spaceSize: 4096,
    randomSeed: 7,
    simulationGravity: 0.5,
    simulationRepulsion: 1,
    simulationDecay: 100000,
    simulationRepulsionSamples: samples,
  })
  simulation.setPointPositions(clusteredPositions())
  simulation.applyData()
  await simulation.ready
  return simulation
}

const stepUntil = async (simulation: GraphSimulation, done: () => boolean, maxSteps: number): Promise<void> => {
  for (let i = 0; i < maxSteps && !done(); i += 1) {
    simulation.step()
    // The occupancy read lands on a later tick, behind a GPU fence.
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

describe('near-field sampling', () => {
  it('rejects a sample count that is not a positive integer', () => {
    for (const samples of [0, -8, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new GraphSimulation({ simulationRepulsionSamples: samples })).toThrow(RangeError)
    }
  })

  it('fixes the count to the configured value and applies a change on the next tick', async () => {
    const simulation = await createSimulation(16)
    try {
      expect(slotCount(simulation)).toBe(16)
      await stepUntil(simulation, () => false, 40)
      expect(slotCount(simulation)).toBe(16)

      simulation.setConfig({ simulationRepulsionSamples: 24 })
      simulation.step()
      expect(slotCount(simulation)).toBe(24)
      const positions = simulation.getPointPositionsArray()
      expect(positions.every(Number.isFinite)).toBe(true)
    } finally {
      simulation.destroy()
    }
  })

  it('starts the automatic count at the floor and raises it for a dense layout', async () => {
    const simulation = await createSimulation()
    try {
      expect(slotCount(simulation)).toBe(8)
      await stepUntil(simulation, () => slotCount(simulation) !== 8, 60)
      // The first measurement sees the initial discs: it wants the cells
      // sampled exhaustively, and 12k points afford the full range.
      expect(slotCount(simulation)).toBe(64)
      const positions = simulation.getPointPositionsArray()
      expect(positions.every(Number.isFinite)).toBe(true)
    } finally {
      simulation.destroy()
    }
  })
})
