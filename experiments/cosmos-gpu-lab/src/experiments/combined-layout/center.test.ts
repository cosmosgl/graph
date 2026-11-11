import { expect, it } from 'vitest'
import { compareArray } from '../many-body/reference'
import { createFixture } from '../many-body/data'
import { createMatchedSession } from '../matched-layout/session'
import { createGraph, stagesFor } from './data'
import { forceSettings } from './production-settings'
import { centerAggregate, centerReference } from './center-reference'
import { createCombinedWebGL } from './webgl'
import { createCombinedWebGPU } from './webgpu'
it('includes pinned points, excludes absent NaNs, and preserves integration masks', () => {
  const points = new Float32Array([-8, 0, 1, 0, 8, 0, 0, 0, NaN, NaN, 0, 1, 9000, -9000, 0, 1])
  expect(centerAggregate(points)).toEqual(new Float32Array([0, 0, 2, 0]))
  const actual = centerReference(points, 1, 1)
  expect(actual.forces[0]).toBeCloseTo(0.08, 6); expect(actual.forces[4]).toBeCloseTo(-0.08, 6)
  expect(actual.positions[0]).toBe(-8); expect(actual.positions[4]).toBeLessThan(8)
  expect(Number.isNaN(actual.positions[8])).toBe(true); expect(actual.positions[12]).toBe(9000)
  const absent = points.slice(); for (let i = 3; i < absent.length; i += 4) absent[i] = 1
  expect(centerAggregate(absent)).toEqual(new Float32Array(4)); expect(centerReference(absent, 1, 1).forces).toEqual(new Float32Array(16))
  expect(stagesFor()).toEqual(['gravity', 'repulsion', 'incoming', 'outgoing'])
  expect(stagesFor(1)).toEqual(['gravity', 'center', 'repulsion', 'incoming', 'outgoing'])
})
for (const kind of ['webgl', 'webgpu'] as const) {
  for (const fixture of ['masked', 'coincident', 'all-absent', 'uniform', 'clusters', 'odd'] as const) {
    it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${kind}: center aggregate, force and integration / ${fixture}`, async () => {
      const count = fixture === 'odd' ? 4097 : fixture === 'uniform' || fixture === 'clusters' ? 8192 : 4
      const { graph, input } = createGraph({ count, fixture: 'chain', decay: 100 })
      input.points = createFixture(fixture === 'clusters' ? 'clusters' : fixture === 'coincident' ? 'coincident' : 'uniform', count).points
      for (let i = 0; i < input.points.length; i += 4) { input.points[i] += 2048; input.points[i + 1] += 2048 }
      if (fixture === 'masked') input.points.set([-8, 0, 1, 0, 8, 0, 0, 0, NaN, NaN, 0, 1, 9000, -9000, 0, 1])
      if (fixture === 'all-absent') for (let i = 3; i < input.points.length; i += 4) input.points[i] = 1
      graph.points = input.points
      const settings = { ...forceSettings('varied32', count), center: 1 }
      const b = kind === 'webgl'
        ? await createCombinedWebGL(document.createElement('canvas'), graph, input, { forceSettings: settings })
        : await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'trig', { forceSettings: settings })
      try {
        b.stepStage('center', 1)
        const actual = await b.read(); const expected = centerReference(input.points, 1, 1)
        const checks = {
          sum: compareArray(await b.readCenter!(), centerAggregate(input.points)),
          forces: compareArray(actual.forces, expected.forces),
          positions: compareArray(actual.positions, expected.positions, input.points),
        }
        // WebGL's unordered f32 blending is a measured control; never hide a
        // failed gate. Small semantic cases must pass both implementations.
        if (kind === 'webgpu' || count === 4) expect(Object.values(checks).every(c => c.valid), JSON.stringify(checks)).toBe(true)
        expect((await b.readCenter!())[2]).toBe(centerAggregate(input.points)[2])
        // Every new center stage must overwrite/clear the aggregate. A repeated
        // reduction is one centroid, even when the previous frame used blending.
        b.setPositions(input.points); b.stepStage('center', 1)
        expect((await b.readCenter!())[2]).toBe(centerAggregate(input.points)[2])
      } finally { b.destroy() }
    })
  }
}
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('center-enabled independent layouts retain stage checks and restoring probes', async () => {
  const s = await createMatchedSession({
    count: 512,
    fixture: 'communities',
    distribution: 'uniform',
    ticks: 20,
    checkpointEvery: 10,
    preset: 'adaptive',
    pinned: true,
    center: 1,
  }, () => document.createElement('canvas'))
  try {
    expect(s.report.errors).toEqual({})
    for (let i = 0; i < 20; i++) await s.step()
    expect(s.report.rows.every(r => r.complete)).toBe(true)
    expect(s.report.rows.filter(r => r.checks.webgpu).every(r => r.checks.webgpu!.valid)).toBe(true)
    expect(s.report.rows[0].checks.webgpu!.stages.map(s => s.stage)).toEqual(stagesFor(1))
    const positions = s.lanes.map(l => l.positions.slice()); const cpu = s.cpu().slice(); const alpha = s.alpha()
    await s.probe(); await s.replay()
    expect(s.cpu()).toEqual(cpu); expect(s.lanes.map(l => l.positions)).toEqual(positions); expect(s.alpha()).toBe(alpha)
  } finally { s.destroy() }
}, 120000)
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('center resources follow resident graph resizing, including empty input', async () => {
  const first = createGraph({ count: 512, fixture: 'chain', decay: 100 })
  const settings = { ...forceSettings('varied32', 512), center: 1 }
  const b = await createCombinedWebGPU(document.createElement('canvas'), first.graph, first.input, 'trig', { forceSettings: settings })
  try {
    for (const count of [4, 0, 512]) {
      const next = createGraph({ count: Math.max(4, count), fixture: 'chain', decay: 100 })
      if (!count) {
        next.input = { points: new Float32Array(), samples: new Float32Array() }
        next.graph = { points: next.input.points, links: new Float32Array(), sizes: new Float32Array(), weights: new Float32Array() }
      }
      b.resizeGraph!(next.graph, next.input, false); b.stepStage('center', 1)
      const actual = await b.read(); const expected = centerReference(next.input.points, 1, 1)
      expect(compareArray(actual.positions, expected.positions).valid).toBe(true)
      expect(compareArray(actual.forces, expected.forces).valid).toBe(true)
      expect(compareArray(await b.readCenter!(), centerAggregate(next.input.points)).valid).toBe(true)
    }
  } finally { b.destroy() }
})
