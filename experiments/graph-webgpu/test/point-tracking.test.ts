import { expect, it, vi } from 'vitest'
import { GraphSimulation, type PointTracker } from '../src'

it('keeps the newest completed tracker snapshot when GPU copies finish out of order', async () => {
  const simulation = new GraphSimulation({ enableSimulation: false, rescalePositions: false })
  // Track before the device or data exists. Duplicates keep their slots in the array.
  const tracker: PointTracker = simulation.trackPoints([1, 0, 1, 3])
  const discarded = simulation.trackPoints([0])
  discarded.destroy()
  simulation.setPointPositions(Float32Array.of(10, 20, 30, 40), true)
  simulation.applyData()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  try {
    await simulation.ready
    const gather = simulation.getPointPositionsByIndicesAsync.bind(simulation)
    const reads = vi.spyOn(simulation, 'getPointPositionsByIndicesAsync').mockImplementationOnce(async indices => {
      const coordinates = await gather(indices)
      await held
      return coordinates
    })
    const earlier = tracker.positionsAsync()
    simulation.setPointPosition(1, 31, 41)
    const latest = await tracker.positionsAsync()
    expect([...latest!]).toEqual([[1, [31, 41]], [0, [10, 20]]])
    release()
    expect([...(await earlier)!]).toEqual([[1, [30, 40]], [0, [10, 20]]])
    expect(tracker.positions().get(1)).toEqual([31, 41])
    expect(tracker.positionsArray()).toEqual([31, 41, 10, 20, 31, 41, NaN, NaN])
    expect(reads).toHaveBeenCalledTimes(2)
    expect(discarded.positionsArray()).toEqual([])
    expect(await discarded.positionsAsync()).toEqual(new Map())
  } finally { release(); simulation.destroy() }
})

it('forgets removed slots even when the reader skips the removal and reads after revival', async () => {
  const simulation = new GraphSimulation({ enableSimulation: false, rescalePositions: false })
  const tracker = simulation.trackPoints([0, 1])
  const replace = (x: number): void => {
    simulation.setPointPositions(Float32Array.of(10, 20, x, 40), true)
    simulation.applyData()
  }
  try {
    await simulation.ready
    replace(30)
    expect((await tracker.positionsAsync())?.get(1)).toEqual([30, 40])
    replace(NaN)
    replace(60)
    expect(tracker.positions({ nonBlocking: true }).has(1)).toBe(false)
    expect((await tracker.positionsAsync())?.get(1)).toEqual([60, 40])
    simulation.destroy()
    expect(tracker.positions().size).toBe(0)
    expect(tracker.positionsArray()).toEqual([])
    expect((await simulation.trackPoints([0]).positionsAsync())?.size).toBe(0)
  } finally { simulation.destroy() }
})
