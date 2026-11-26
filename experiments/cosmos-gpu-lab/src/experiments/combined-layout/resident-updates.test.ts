import { expect, it } from 'vitest'
import { compareArray } from '../many-body/reference'
import { createCombinedWebGPU } from './webgpu'
import { createGraph, cool, type Fixture } from './data'
import { differingBits, createResidentComparison } from './resident'
import { createOracle } from './reference'

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('patches positions and replaces larger, empty and smaller topologies while retaining resident state', async () => {
  const settings = { fixture: 'chain' as Fixture, count: 128, decay: 100, springPrecision: 'trig' as const }
  const { graph, input } = createGraph(settings)
  const b = await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'trig', { gpuBounds: true })
  let points = input.points; let tick = 0; let alpha = 1
  const identity = b.resourceIdentity!()
  try {
    b.stepTick!(alpha, tick); points = (await b.read()).positions; tick++; alpha = cool(alpha, 100)
    const before = points.slice(); const patch = new Float32Array([-32, 16, 1, 0])
    b.patchPositions!(0, patch); points.set(patch, 0)
    expect(differingBits((await b.read()).positions, points)).toBe(0)
    expect(differingBits(points.subarray(4), before.subarray(4))).toBe(0)
    expect(() => b.patchPositions!(-1, patch)).toThrow('range')
    expect(() => b.patchPositions!(128, patch)).toThrow('range')
    expect(() => b.patchPositions!(0, new Float32Array([Infinity, 0, 0, 0]))).toThrow('values')
    expect(differingBits((await b.read()).positions, points)).toBe(0)
    const bytes: number[] = []
    for (const fixture of ['communities', 'empty', 'star', 'chain'] as const) {
      const next = createGraph({ ...settings, fixture: fixture === 'empty' ? 'chain' : fixture }).graph
      if (fixture === 'empty') { next.links = new Float32Array(); next.weights = new Float32Array() }
      const result = b.replaceLinks!(next); bytes.push(result.bytes)
      expect(result.version).toBe(bytes.length)
      expect(b.resourceIdentity!()).toEqual(identity)
      expect(differingBits((await b.read()).positions, points)).toBe(0)
      const expected = createOracle(next, input).tick(points, alpha, tick)
      b.stepTick!(alpha, tick); b.render([0, 0, 1 / 256, 1 / 256])
      const actual = (await b.read()).positions
      expect(compareArray(actual, expected).valid, `${fixture}: ${JSON.stringify(compareArray(actual, expected))}`).toBe(true)
      expect(Array.from(actual.slice(0, 4))).toEqual(Array.from(patch))
      points = actual; tick++; alpha = cool(alpha, 100)
    }
    expect(bytes[0]).toBeGreaterThan(bytes[1]); expect(bytes[2]).toBeGreaterThan(bytes[1])
    expect(() => b.replaceLinks!({ ...graph, sizes: new Float32Array(1) })).toThrow('lengths')
    expect(differingBits((await b.read()).positions, points)).toBe(0)
  } finally { b.destroy() }
  expect(() => b.patchPositions!(0, new Float32Array(4))).toThrow('destroyed')
  expect(() => b.replaceLinks!(graph)).toThrow('destroyed')
})

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('live edits preserve cooling and history and both lanes agree on the next checked tick', async () => {
  const s = await createResidentComparison({ fixture: 'chain', count: 128, decay: 20, springPrecision: 'trig' },
    () => document.createElement('canvas'))
  try {
    await s.step(true); const alpha = s.alpha(); const history = JSON.stringify(s.rows)
    s.patchPoint(0, new Float32Array([-32, 16, 1, 0])); s.replaceLinks('communities')
    expect(s.tick()).toBe(1); expect(s.alpha()).toBe(alpha); expect(JSON.stringify(s.rows)).toBe(history)
    expect(s.updates).toHaveLength(2)
    expect(s.updates.every(u => u.lanes.every(l => l.deviceRetained && l.positionsRetained))).toBe(true)
    expect((await s.step(true))?.valid).toBe(true)
    s.replaceLinks('empty'); expect((await s.step(true))?.valid).toBe(true)
    s.replaceLinks('star'); expect((await s.step(true))?.valid).toBe(true)
  } finally { s.destroy() }
})
