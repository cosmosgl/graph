import { expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { differingBits } from './resident'
import { cool, createGraph } from './data'
import { forceSettings } from './production-settings'
import { createCombinedWebGPU } from './webgpu'

for (const count of [8192, 16384]) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`chunked repulsion preserves independent combined ticks at ${count} points`, async () => {
    const canvas = document.createElement('canvas'); const device = await createDevice('webgpu', canvas)
    const { graph, input } = createGraph({ count, fixture: 'communities', decay: 100 })
    for (let i = 0; i < input.points.length; i += 4) { input.points[i] += 2048; input.points[i + 1] -= 2048 }
    input.points[2] = 1; input.points.set([NaN, NaN, 0, 1], 4)
    const settings = { ...forceSettings('varied32', count), center: 0.1, origin: [2048, -2048] as [number, number] }
    const backends = []
    try {
      for (const farMode of ['streamed', 'chunked'] as const) {
        backends.push(await createCombinedWebGPU(canvas, graph, input, 'trig', {
          context: { device },
          forceSettings: settings,
          gpuBounds: true,
          gridAggregation: 'cached-small',
          repulsionPolicy: 'production',
          springOptimization: 'prefetch',
          farMode,
          farChunkSize: 4096,
        }))
      }
      let alpha = 1
      for (let tick = 0; tick < 10; tick++) {
        for (const backend of backends) backend.stepTick!(alpha, tick)
        const states = await Promise.all(backends.map(async backend => backend.read()))
        expect(differingBits(states[0].positions, states[1].positions), `position tick ${tick}`).toBe(0)
        expect(differingBits(states[0].forces, states[1].forces), `force tick ${tick}`).toBe(0)
        expect(states[1].positions[2]).toBe(1)
        expect(states[1].positions[3]).toBe(0)
        expect(Number.isNaN(states[1].positions[4])).toBe(true)
        expect(states[1].positions[7]).toBe(1)
        alpha = cool(alpha, 100)
      }
    } finally { backends.forEach(backend => backend.destroy()); device.destroy() }
  }, 120000)
}
