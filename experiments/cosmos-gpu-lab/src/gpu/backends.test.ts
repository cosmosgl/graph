import { expect, it } from 'vitest'
import { createWebGLCenterMass } from '../experiments/center-mass/webgl/backend'
import { createWebGPUCenterMass } from '../experiments/center-mass/webgpu/backend'
import { createWebGLPointRenderer } from '../experiments/point-rendering/webgl/backend'
import { createWebGPUPointRenderer } from '../experiments/point-rendering/webgpu/backend'
import { createWebGLSimulationBenchmark } from '../experiments/performance-lab/webgl-simulation'
import { deviceForTest } from './test-device'

for (const create of [createWebGLCenterMass, createWebGPUCenterMass]) {
  it(`${create.name}: reduction preserves counts and signed sums across repeated uploads`, async context => {
    if (create === createWebGPUCenterMass) {
      const probe = await deviceForTest(); if (!probe) { context.skip(); return }; probe.destroy()
    }
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
    const count = 513
    const backend = await create(canvas, count)
    try {
      for (const offset of [-0.25, 0.125]) {
        const positions = Float32Array.from({ length: count * 2 }, (_, i) => i % 2 ? 0.125 : offset)
        const { center } = await backend.run(positions)
        expect(center.count).toBe(count); expect(center.x).toBeCloseTo(offset, 6); expect(center.y).toBeCloseTo(0.125, 6)
      }
    } finally { backend.destroy() }
  })
}
for (const create of [createWebGLPointRenderer, createWebGPUPointRenderer]) {
  it(`${create.name}: circle drawing and completion measurement work through luma`, async context => {
    if (create === createWebGPUPointRenderer) {
      const probe = await deviceForTest(); if (!probe) { context.skip(); return }; probe.destroy()
    }
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; document.body.append(canvas)
    const backend = await create(canvas)
    try {
      backend.setData({ count: 1, positions: new Float32Array([0, 0]), colors: new Float32Array([1, 0, 0, 1]) })
      const measured = await backend.measure(20, 2)
      expect(measured.completionMilliseconds).toBeGreaterThanOrEqual(measured.submitMilliseconds)
      backend.render(20)
      const copy = document.createElement('canvas'); copy.width = 64; copy.height = 64
      const ctx = copy.getContext('2d')!; ctx.drawImage(canvas, 0, 0)
      const pixel = ctx.getImageData(32, 32, 1, 1).data
      expect(pixel[0]).toBeGreaterThan(240); expect(pixel[1]).toBeLessThan(10)
    } finally { backend.destroy(); canvas.remove() }
  })
}
it('WebGL performance reduction retains one-count validation after batched draws', async () => {
  const backend = await createWebGLSimulationBenchmark(document.createElement('canvas'), 513)
  try {
    expect((await backend.readCenter()).count).toBe(513)
    expect((await backend.benchmark(3)).averageMilliseconds).toBeGreaterThanOrEqual(0)
    expect((await backend.readCenter()).count).toBe(513)
  } finally { backend.destroy() }
})

it('hierarchical reduction preserves the center through three levels and GPU rotation', async context => {
  const probe = await deviceForTest(); if (!probe) { context.skip(); return }; probe.destroy()
  const { createScalableReductionBackend } = await import('../experiments/scalable-reduction/backend')
  const { calculateInitialCpuCenter, rotateCpuCenter } = await import('../experiments/scalable-reduction/reference')
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
  const count = 65537; const backend = await createScalableReductionBackend(canvas, count)
  try {
    expect(backend.reductionCounts).toEqual([65537, 257, 2, 1])
    let expected = calculateInitialCpuCenter(count)!
    for (const advance of [false, true, true]) {
      if (advance) expected = rotateCpuCenter(expected)
      const { center } = await backend.run(advance, true)
      expect(center?.count).toBe(count)
      expect(center!.x).toBeCloseTo(expected.x, 6); expect(center!.y).toBeCloseTo(expected.y, 6)
    }
    expect((await backend.benchmark(3)).averageMilliseconds).toBeGreaterThanOrEqual(0)
  } finally { backend.destroy() }
})

it.for([0, 513])('grid clear and hierarchical scan survive repeated builds with %s points', async (count, context) => {
  const probe = await deviceForTest(); if (!probe) { context.skip(); return }; probe.destroy()
  const { createSpatialGridBackend } = await import('../experiments/spatial-grid/backend')
  const { createGridPositions, createCpuGridReference, validateGrid } = await import('../experiments/spatial-grid/reference')
  const positions = createGridPositions(count, 'clusters'); const size = 257
  const backend = await createSpatialGridBackend(positions, size)
  try {
    const expected = createCpuGridReference(positions, size)
    await backend.build(); await backend.benchmark(3)
    const actual = await backend.readback()
    expect(actual.counts).toEqual(expected.counts); expect(actual.offsets).toEqual(expected.offsets)
    expect(validateGrid(positions, size, expected, actual.counts, actual.offsets, actual.pointIndices).valid).toBe(true)
  } finally { backend.destroy() }
})
