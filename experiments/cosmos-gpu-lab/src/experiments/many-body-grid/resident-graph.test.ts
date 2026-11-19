import { expect, it } from 'vitest'
import { fitView } from '../many-body/backend'
import { compareArray } from '../many-body/reference'
import { cool } from '../combined-layout/data'
import { createCombinedWebGPU } from '../combined-layout/webgpu'
import { createResidentChain, createResidentGraph } from './resident-graph'

it('moves and draws a small graph against the bounded WebGPU layout', async () => {
  const count = 513; const { input, graph } = createResidentChain(count); const initial = input.points.slice()
  const canvas = (): HTMLCanvasElement => { const c = document.createElement('canvas'); c.width = 480; c.height = 340; return c }
  const candidate = await createResidentGraph(canvas(), input, graph)
  const control = await createCombinedWebGPU(canvas(), graph, input, 'baseline', {
    gpuBounds: true,
    gridAggregation: 'cached-small',
    farMode: 'workgroup-native-far',
    nearArithmetic: 'native',
    forceSettings: { samples: 8, precise: false, variation: [1, 1] },
  })
  try {
    let alpha = 1; const view = fitView([initial])
    for (let tick = 0; tick < 8; tick++) {
      candidate.frame(tick, alpha); control.stepTick!(alpha, tick); control.render(view)
      alpha = cool(alpha, 200)
    }
    const [actual, expected] = await Promise.all([candidate.read(), control.read()])
    const strict = compareArray(actual.positions, expected.positions, initial)
    let square = 0; let largest = 0
    for (let i = 0; i < count; i++) {
      const offset = i * 4
      expect(actual.positions[offset + 2]).toBe(initial[offset + 2]); expect(actual.positions[offset + 3]).toBe(initial[offset + 3])
      if (initial[offset + 2] > 0.5 || initial[offset + 3] > 0.5) {
        expect(actual.positions[offset]).toBe(initial[offset]); expect(actual.positions[offset + 1]).toBe(initial[offset + 1])
      }
      expect(Number.isFinite(actual.positions[offset]) && Number.isFinite(actual.positions[offset + 1])).toBe(true)
      const delta = Math.hypot(actual.positions[offset] - expected.positions[offset], actual.positions[offset + 1] - expected.positions[offset + 1])
      square += delta * delta; largest = Math.max(largest, delta)
    }
    const rms = Math.sqrt(square / count)
    expect(rms, JSON.stringify({ strict, rms, largest })).toBeLessThan(0.1)
    expect(largest, JSON.stringify({ strict, rms, largest })).toBeLessThan(1)
    expect(actual.positions.some((value, index) => index % 4 < 2 && Math.abs(value - initial[index]) > 0.01)).toBe(true)
  } finally { candidate.destroy(); control.destroy() }
}, 120000)
