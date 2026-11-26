import { expect, it, vi } from 'vitest'
import { luma } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { Graph, GraphSimulation } from '@cosmos.gl/graph'

it('preserves the last row through static queries, enabling every force, a pointer kick and a later pause', async () => {
  const count = 97 * 256 + 1
  const pinned = count - 3
  const moving = count - 2
  const absent = count - 1
  const positions = new Float32Array(count * 2).fill(NaN)
  positions.set([110, 100], 0)
  positions.set([120, 100, 122, 100], pinned * 2)

  const run = async (limitRows: boolean): Promise<Float32Array> => {
    const simulation = new GraphSimulation({
      enableSimulation: false,
      rescalePositions: false,
      randomSeed: 'multi-row',
      simulationGravity: 0.3,
      simulationCenter: 0.1,
      simulationRepulsion: 0.1,
      simulationLinkSpring: 0.3,
      simulationAttractor: 0.1,
      simulationCluster: 0.2,
      simulationCollision: 0.3,
      simulationCollisionRadius: 2,
    })
    try {
      await simulation.ready
      if (limitRows) {
        // The GPU is real. Limit the layout to 97 groups on each axis so the
        // last live point exercises a second row of both 64- and 256-lane jobs.
        const device = simulation.device!
        Object.defineProperty(device, 'limits', { value: Object.create(device.limits, { maxComputeWorkgroupsPerDimension: { value: 97 } }) })
      }
      simulation.setPointPositions(positions, true)
      simulation.setLinks(Float32Array.of(0, moving))
      simulation.setPinnedPoint(pinned, true)
      const clusters = new Array<number | undefined>(count).fill(undefined)
      clusters[0] = clusters[moving] = 0
      simulation.setPointClusters(clusters)
      simulation.setClusterPositions([-30, 80])
      const attractors = new Float32Array(count * 2).fill(NaN)
      attractors.set([101, 103], moving * 2)
      simulation.setPointAttractors(attractors)
      simulation.applyData(1)
      const source = simulation.getPointPositionBuffer()!
      expect(source.count).toBe(count)
      expect(source.buffer.byteLength).toBe(count * 16)
      expect(await simulation.getBoundsAsync()).toEqual([110, 100, 122, 100])
      expect(await simulation.getClusterPositionsAsync()).toEqual([116, 100])
      const ids = [0, pinned, moving, absent]
      const staticXY = Float32Array.of(110, 100, 120, 100, 122, 100, NaN, NaN)
      expect(await simulation.getPointPositionsByIndicesAsync(ids)).toEqual(staticXY)
      const repeated = new Array<number>(97 * 64 + 1).fill(absent)
      repeated[repeated.length - 1] = moving
      expect((await simulation.getPointPositionsByIndicesAsync(repeated)).slice(-4)).toEqual(Float32Array.of(NaN, NaN, 122, 100))
      simulation.step()
      expect(await simulation.getPointPositionsByIndicesAsync(ids)).toEqual(staticXY)
      simulation.setConfig({ enableSimulation: true })
      simulation.step()
      simulation.applyMouseRepulsion(110, 90)
      const active = await simulation.getPointPositionsByIndicesAsync(ids)
      expect(active.slice(2, 4)).toEqual(Float32Array.of(120, 100))
      expect(active.slice(4, 6)).not.toEqual(Float32Array.of(122, 100))
      expect(active.slice(6)).toEqual(Float32Array.of(NaN, NaN))
      simulation.setConfig({ enableSimulation: false })
      simulation.step()
      expect(await simulation.getPointPositionsByIndicesAsync(ids)).toEqual(active)
      return active
    } finally { simulation.destroy() }
  }
  expect(await run(true)).toEqual(await run(false))
})

it('retries an unsupported owned binding limit on a fresh core device', async () => {
  type Descriptor = { requiredLimits?: { maxStorageBufferBindingSize?: number } }
  type Adapter = { requestDevice(descriptor?: Descriptor): Promise<unknown> }
  const { gpu } = navigator as Navigator & { gpu: { requestAdapter(): Promise<Adapter> } }
  const prototype = Object.getPrototypeOf(await gpu.requestAdapter()) as Adapter
  const request = prototype.requestDevice
  const requested: Array<number | undefined> = []
  const baseline = 128 * 1024 * 1024
  const spy = vi.spyOn(prototype, 'requestDevice').mockImplementation(function (this: Adapter, descriptor) {
    const bytes = descriptor?.requiredLimits?.maxStorageBufferBindingSize
    requested.push(bytes)
    if (bytes && bytes > baseline) return Promise.reject(new DOMException('Unsupported maxStorageBufferBindingSize limit', 'OperationError'))
    return request.call(this, descriptor)
  })
  const simulation = new GraphSimulation({ enableSimulation: false, rescalePositions: false })
  try {
    await simulation.ready
    expect(requested).toEqual([160_000_000, undefined])
    expect(simulation.device!.limits.maxStorageBufferBindingSize).toBe(baseline)
    simulation.setPointPositions(Float32Array.of(100, 100, 120, 100), true)
    simulation.applyData()
    expect(await simulation.getBoundsAsync()).toEqual([100, 100, 120, 100])
  } finally { simulation.destroy(); spy.mockRestore() }
})

it('reports the granted binding size on a borrowed device and accepts a smaller replacement after rejection', async () => {
  const device = await luma.createDevice({ type: 'webgpu', adapters: [webgpuAdapter], waitForPageLoad: false })
  const simulation = new GraphSimulation({ enableSimulation: false, rescalePositions: false }, Promise.resolve(device))
  try {
    await simulation.ready
    expect(simulation.device).toBe(device)
    expect(simulation.ownsDevice).toBe(false)
    Object.defineProperty(device, 'limits', { value: Object.create(device.limits, { maxStorageBufferBindingSize: { value: 128 } }) })
    const initial = Float32Array.of(1, 2, 3, 4)
    simulation.setPointPositions(initial, true)
    simulation.applyData()
    const source = simulation.getPointPositionBuffer()!
    simulation.setPointPositions(new Float32Array(18), true)
    expect(() => simulation.applyData()).toThrow(/Point position buffer requires 144 bytes of storage .*128/)
    expect(simulation.data.pointPositions).toBe(initial)
    expect(simulation.getPointPositionBuffer()!.buffer).toBe(source.buffer)
    expect(await simulation.getPointPositionsAsync()).toEqual(initial)
    await expect(simulation.getPointPositionsByIndicesAsync(Array<number>(9).fill(0))).rejects.toThrow(/Gathered position buffer requires 144 bytes/)
    simulation.setPointPositions(Float32Array.of(5, 6, 7, 8), true)
    simulation.applyData()
    expect(await simulation.getBoundsAsync()).toEqual([5, 6, 7, 8])
  } finally { simulation.destroy(); device.destroy() }
})

it('retargets the displayed position on a later dispatch row during a transition', async () => {
  const host = document.createElement('div')
  host.style.cssText = 'width:160px;height:100px'
  document.body.append(host)
  const graph = new Graph(host, { enableSimulation: false, enableRenderLoop: false, rescalePositions: false, fitViewOnInit: false })
  const tail = 190
  const update = (x: number, duration: number): void => {
    const xy = new Float32Array(2 * (tail + 1)).fill(NaN)
    xy.set([x, 2048], 2 * tail)
    graph.setPointPositions(xy, true)
    graph.render(undefined, duration)
  }
  const read = async (): Promise<number> => (await graph.simulation.getPointPositionsByIndicesAsync([tail]))[0]!
  try {
    await graph.ready
    update(2048, 0)
    const device = graph.simulation.device!
    const limits = Object.create(device.limits, { maxComputeWorkgroupsPerDimension: { value: 2 } })
    Object.defineProperty(device, 'limits', { value: limits })
    let clock = performance.now()
    const time = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    try {
      update(2068, 100)
      clock += 50
      graph.renderOneFrame()
      expect(await read()).toBe(2058)
      update(2038, 100)
      clock += 50
      graph.renderOneFrame()
      expect(await read()).toBe(2048)
      clock += 50
      graph.renderOneFrame()
      expect(await read()).toBe(2038)
    } finally { time.mockRestore() }
  } finally { graph.destroy(); host.remove() }
})
