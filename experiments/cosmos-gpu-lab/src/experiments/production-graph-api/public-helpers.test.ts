import { expect, it } from 'vitest'
import { loadGraphPackage, loadGraphSimulationPackage } from '../viewer-comparison/production-bundle'

for (const engine of ['webgl', 'webgpu'] as const) {
  it(`${engine}: pair, flatten and create preserve the processed-data boundary`, async () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    try {
      const GRAPH = await loadGraphPackage(engine, frame.contentDocument!)
      const graph = new GRAPH(null, { enableSimulation: false, rescalePositions: false, transitionDuration: 0 })
      try {
        const tuple: [number, number] = [NaN, -0]
        const flat = graph.flatten([tuple, [Infinity, 32]])
        expect(flat).toEqual([NaN, -0, Infinity, 32])
        const pairs = graph.pair([...flat, 9])
        expect(pairs).toEqual([tuple, [Infinity, 32]])
        pairs[0]![0] = 3
        flat[1] = 4
        expect(tuple).toEqual([NaN, -0])
        expect(graph.pair([9])).toEqual([])
        expect(graph.flatten([])).toEqual([])

        const initial = Float32Array.of(1000, 1000)
        graph.setPointPositions(initial)
        graph.create()
        await graph.ready
        expect(graph.simulation.device?.type).toBe(engine)
        expect(graph.graph.pointPositions).toBeUndefined()
        graph.render(0, 0)
        expect(graph.graph.pointPositions).toBe(initial)
        // The reference spends its upload flag in create() before its first
        // data resolve. The candidate completes the pending upload on render().
        expect(Array.from(await graph.getPointPositionsAsync())).toEqual(engine === 'webgl' ? [] : [...initial])
        graph.setPointPositions(initial)
        graph.render(0, 0)
        graph.setPointPosition(0, 1020, 1030)
        graph.create()
        expect(Array.from(await graph.getPointPositionsAsync())).toEqual([1020, 1030])
        const next = Float32Array.of(1100, 1200)
        graph.setPointPositions(next)
        graph.create()
        expect(graph.graph.pointPositions).toBe(initial)
        expect(Array.from(await graph.getPointPositionsAsync())).toEqual([...initial])
        graph.render(0, 0)
        expect(graph.graph.pointPositions).toBe(next)
        expect(Array.from(await graph.getPointPositionsAsync())).toEqual(engine === 'webgl' ? [...initial] : [...next])
        graph.setPointPositions(next)
        graph.graph.update()
        graph.create()
        expect(Array.from(await graph.getPointPositionsAsync())).toEqual([...next])
        const previousColors = graph.getPointColors()
        const green = Float32Array.of(0, 1, 0, 1)
        graph.setPointColors(green)
        graph.create()
        expect([...graph.getPointColors()]).toEqual([...previousColors])
        graph.render(undefined, 0)
        expect([...graph.getPointColors()]).toEqual([...green])
        expect(graph.simulation.store.alpha).toBe(0)
      } finally { graph.destroy() }
      expect(() => graph.create()).not.toThrow()
      expect(graph.pair([5, 6])).toEqual([[5, 6]])
      const cancelled = new GRAPH(null)
      cancelled.create()
      cancelled.destroy()
      await cancelled.ready
      expect(cancelled.isReady).toBe(false)
    } finally { frame.remove() }
  })

  it(`${engine}: reads headless cluster centroids after a regroup and teardown`, async () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    try {
      const SIMULATION = await loadGraphSimulationPackage(engine, frame.contentDocument!)
      const simulation = new SIMULATION({ rescalePositions: false })
      try {
        expect(simulation.getClusterPositions()).toEqual([])
        simulation.setPointPositions(Float32Array.of(24, 60, 40, 20, 104, 92))
        simulation.setPointClusters([0, 0, 1])
        simulation.applyData(0)
        await simulation.ready
        expect(simulation.device?.type).toBe(engine)
        const poll = (): readonly number[] => simulation.getClusterPositions({ nonBlocking: true })
        const initial = [32, 40, 104, 92]
        expect(poll()).toEqual(engine === 'webgl' ? initial : [])
        await expect.poll(poll).toEqual(initial)
        simulation.setPointPosition(1, 48, 28)
        await expect.poll(poll).toEqual([36, 44, 104, 92])
        simulation.setPointClusters([1, 0, 0])
        simulation.applyData(0)
        const regrouped = [76, 60, 24, 60]
        expect(poll()).toEqual(engine === 'webgl' ? regrouped : [])
        await expect.poll(poll).toEqual(regrouped)
      } finally { simulation.destroy() }
      expect(simulation.getClusterPositions()).toEqual([])
    } finally { frame.remove() }
  })
}
