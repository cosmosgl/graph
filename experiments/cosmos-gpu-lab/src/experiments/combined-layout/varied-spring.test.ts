import { expect, it } from 'vitest'
import { compareArray } from '../weighted-links/reference'
import { createGraph } from './data'
import { forceSettings } from './production-settings'
import { createOracle } from './reference'
import { createCombinedWebGPU } from './webgpu'

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('replays the varied-star outgoing cancellation without relaxing the spring budget', async () => {
  const { graph, input } = createGraph({ count: 8192, fixture: 'star', decay: 100, springPrecision: 'trig' })
  for (let i = 3; i < input.points.length; i += 4) input.points[i] = 1
  // Keep original point/edge IDs and degrees, with only the failing source pair
  // present. The minimal capture is from the 100-tick full-strength probe.
  input.points.set([-23.369497299194336, -0.36307987570762634, 1, 0], 0)
  input.points.set([85.20146179199219, 84.82380676269531, 0, 0], 4101 * 4)
  const settings = forceSettings('varied32', 8192)
  const expected = createOracle(graph, input, 'production', settings).stage('outgoing', input.points, 1, 100)
  const b = await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'trig', { forceSettings: settings })
  try {
    b.stepStage('outgoing', 1); const actual = await b.read()
    const i = 4101 * 4
    const checks = { forces: compareArray(actual.forces, expected.forces), positions: compareArray(actual.positions, expected.positions) }
    expect(checks.forces.valid).toBe(true)
    expect(checks.positions.valid, JSON.stringify({
      checks,
      actual: actual.positions.slice(i, i + 2),
      expected: expected.positions.slice(i, i + 2),
      actualForce: actual.forces.slice(i, i + 2),
      expectedForce: expected.forces.slice(i, i + 2),
    })).toBe(true)
  } finally { b.destroy() }
})
