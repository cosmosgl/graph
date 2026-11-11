import { expect, it } from 'vitest'
import { createGraph } from '../combined-layout/data'
import { forceSettings } from '../combined-layout/production-settings'
import { alignedDrift, sharedView, springMismatch, stress, stressPairs } from './metrics'
it('fits stress scale, preserves raw size in alignment, and centers the shared camera', () => {
  const { graph } = createGraph({ count: 4, fixture: 'chain', decay: 100 })
  const points = new Float32Array([0, 0, 0, 0, 10, 0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0])
  const moved = points.slice()
  for (let i = 0; i < points.length; i += 4) { moved[i] = 2048; moved[i + 1] = 2048 + points[i] }
  const { pairs } = stressPairs(graph)
  expect(pairs).toHaveLength(6); expect(stress(points, pairs).rms).toBeCloseTo(0, 12)
  expect(stress(moved, pairs).rms).toBeCloseTo(0, 12); expect(alignedDrift(moved, points)).toBeCloseTo(0, 12)
  const scaled = points.slice()
  for (let i = 0; i < scaled.length; i += 4) scaled[i] *= 3
  expect(stress(scaled, pairs).rms).toBeCloseTo(0, 12); expect(alignedDrift(scaled, points)).toBeGreaterThan(10)
  moved[13] += 30
  expect(alignedDrift(moved, points)).toBeGreaterThan(10)
  expect(sharedView([new Float32Array([2048, 2048, 0, 0])]).slice(0, 2)).toEqual([2048, 2048])
})
it('omits absent and disconnected pairs, handles collapse, and samples landmarks deterministically', () => {
  const { graph } = createGraph({ count: 512, fixture: 'chain', decay: 100 })
  graph.points[4 * 256 + 3] = 1
  const a = stressPairs(graph); const b = stressPairs(graph)
  expect(a).toEqual(b); expect(a.landmarks).toHaveLength(16); expect(a.unreachable).toBeGreaterThan(0)
  expect(a.pairs.every(p => p.a !== 256 && p.b !== 256)).toBe(true)
  expect(stress(new Float32Array(graph.points.length), a.pairs)).toEqual({ rms: 1, fittedScale: null })
  expect(stress(graph.points, [])).toEqual({ rms: null, fittedScale: null })
})
it('uses both directional random rest lengths instead of assuming every spring wants length ten', () => {
  const { graph } = createGraph({ count: 4, fixture: 'chain', decay: 100 })
  graph.points.set([0, 0, 0, 0, 10, 0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0])
  expect(springMismatch(graph.points, graph, forceSettings('reference', 4))).toBe(0)
  expect(springMismatch(graph.points, graph, forceSettings('varied32', 4))).toBeGreaterThan(0)
})
