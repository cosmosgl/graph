import { expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { compare } from '../many-body/reference'
import { buildTopology } from '../weighted-links/data'
import { createCombinedWebGPU } from './webgpu'
import { createHubGraph, hubDegrees } from './hub-spring-data'
import { createOracle } from './reference'
import { STAGES } from './data'
import { differingBits } from './resident'
import { createHubStudy, hubSummary } from './hub-study'
it('sweeps hub degree without changing edge count, point input or total connectivity', () => {
  const degrees = hubDegrees(8192); expect(degrees).toEqual([64, 256, 1024, 4096, 8191])
  const fixed = createHubGraph(8192, 8191, false)
  for (const degree of degrees) {
    const { graph, input } = createHubGraph(8192, degree, false); const t = buildTopology(graph)
    expect(graph.links.length).toBe((8192 - 1) * 2)
    expect(t.directions[0].offsets[1]).toBe(degree)
    expect(new Set(Array.from(graph.links)).size).toBe(8192)
    expect(input.points).toEqual(fixed.input.points); expect(input.samples).toEqual(fixed.input.samples)
    const pinned = createHubGraph(8192, degree, true)
    const changed = pinned.input.points.slice(); changed[2] = 0
    expect(changed).toEqual(input.points); expect(pinned.graph.links).toEqual(graph.links)
  }
})
for (const optimization of ['hoist', 'prefetch'] as const) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${optimization}: preserves each stage, CPU tolerance, updates and normal frame bits`, async () => {
    const canvas = document.createElement('canvas'); const device = await createDevice('webgpu', canvas)
    const data = createHubGraph(256, 129, false)
    // Exercise an absent neighbor and a partial cache tile without changing the
    // present coordinates, and keep computing a pinned point's force.
    data.input.points[7] = 1
    const backends = []
    try {
      for (const springOptimization of ['baseline', optimization] as const) {
        backends.push(await createCombinedWebGPU(canvas, data.graph, data.input, 'trig', {
          gpuBounds: true, context: { device }, springOptimization,
        }))
      }
      const oracle = createOracle(data.graph, data.input); let points = data.input.points
      for (const b of backends) b.setGpuFrame!(0)
      for (const stage of STAGES) {
        const cpu = oracle.stage(stage, points, 1, 0)
        for (const b of backends) b.stepStage(stage, 1)
        const snapshots = await Promise.all(backends.map(b => b.read()))
        expect(compare(snapshots[0], cpu).valid).toBe(true)
        expect(compare(snapshots[1], cpu).valid).toBe(true)
        expect(differingBits(snapshots[0].forces, snapshots[1].forces)).toBe(0)
        expect(differingBits(snapshots[0].positions, snapshots[1].positions)).toBe(0)
        points = snapshots[0].positions
      }
      for (const b of backends) b.setPositions(data.input.points)
      const frames = []
      for (const b of backends) frames.push(await b.measureCurrentFrame!(1, 0, [0, 0, 1 / 256, 1 / 256]))
      expect(differingBits(frames[0].snapshot.positions, frames[1].snapshot.positions)).toBe(0)
      expect(differingBits(frames[0].snapshot.forces, frames[1].snapshot.forces)).toBe(0)
      // Replacing links must also refresh the hub dispatch lists.
      const next = createHubGraph(256, 63, true)
      for (const b of backends) { b.replaceLinks!(next.graph); b.setPositions(next.input.points); b.stepTick!(1, 0) }
      const updated = await Promise.all(backends.map(b => b.read()))
      expect(differingBits(updated[0].positions, updated[1].positions)).toBe(0)
      expect(differingBits(updated[0].forces, updated[1].forces)).toBe(0)
      // Exercise more than one hub workgroup, including a high-degree target
      // in the reverse direction, varied weights and an incomplete cache tile.
      const multi = createHubGraph(256, 129, false)
      for (let i = 0; i < 65; i++) {
        multi.graph.links.set([0, i + 1], i * 2)
        multi.graph.links.set([128, i + 1], (i + 65) * 2)
        multi.graph.links.set([i + 1, 192], (i + 130) * 2)
      }
      for (let i = 195; i < 255; i++) multi.graph.links.set([i, i + 1], i * 2)
      multi.input.points[128 * 4 + 2] = 1
      multi.graph.weights.set(multi.graph.weights.map((_, i) => 0.25 + (i % 7) / 4))
      for (const b of backends) { b.replaceLinks!(multi.graph); b.setPositions(multi.input.points) }
      const multiOracle = createOracle(multi.graph, multi.input); points = multi.input.points
      for (const stage of STAGES) {
        const cpu = multiOracle.stage(stage, points, 1, 0)
        for (const b of backends) b.stepStage(stage, 1)
        const snapshots = await Promise.all(backends.map(b => b.read()))
        expect(snapshots.every(s => compare(s, cpu).valid)).toBe(true)
        expect(differingBits(snapshots[0].positions, snapshots[1].positions)).toBe(0)
        expect(differingBits(snapshots[0].forces, snapshots[1].forces)).toBe(0)
        points = snapshots[0].positions
      }
      const smaller = createHubGraph(128, 127, false)
      for (const b of backends) { b.resizeGraph!(smaller.graph, smaller.input, false); b.stepTick!(1, 0) }
      const resized = await Promise.all(backends.map(b => b.read()))
      expect(differingBits(resized[0].positions, resized[1].positions)).toBe(0)
      expect(differingBits(resized[0].forces, resized[1].forces)).toBe(0)
    } finally { backends.forEach(b => b.destroy()); device.destroy() }
  })
}
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('measures normal frames on one device and validates every frozen frame', async () => {
  const s = await createHubStudy(document.createElement('canvas'), { warmups: 0, samples: 4, frames: 4, diagnostics: false, batched: true })
  try {
    await s.run([{ count: 8192, degree: 8191, pinned: false, optimization: 'prefetch' }], { cancelled: () => false, progress: () => {} })
    const row = s.report.rows[0]
    expect(s.report.error, JSON.stringify(s.report)).toBeUndefined(); expect(s.report.status).toBe('complete')
    expect(row.valid).toBe(true); expect(row.stages).toHaveLength(4); expect(row.anchors.every(a => a.valid)).toBe(true)
    expect(row.trials).toHaveLength(8)
    expect(row.trials.every(t => t.frames.length === 4 && t.frames.every(f => f.check.valid))).toBe(true)
    if (row.trials.every(t => t.timing.timerStatus === 'valid')) {
      for (const trial of row.trials) expect(trial.frames.reduce((sum, f) => sum + f.gpuMs!, 0)).toBeCloseTo(trial.timing.batchGpuMs!, 10)
    }
    expect(hubSummary(row, s.report.policy, 1, 'normal').samples).toBe(4)
    expect(row.cleanup).toEqual([0, 0]); expect(s.report.sameDevice).toBe(true)
  } finally { s.destroy() }
  expect(s.remainingBytes()).toEqual([0, 0])
}, 120000)
