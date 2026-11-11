import { expect, it, vi } from 'vitest'
import { Kernel } from '@luma.gl/engine'
import { createCapacityLane, CAPACITY_CYCLE } from './capacity'
import { createCapacitySession } from './capacity-session'
import { differingBits } from './resident'
const native = it.skipIf(!import.meta.env.LAB_NATIVE_GPU)
native('reuses buffers and kernels while logical bounds, grid depth and topology change', async () => {
  const s = await createCapacitySession({ fixture: 'chain', count: 32, decay: 100, springPrecision: 'trig' },
    () => document.createElement('canvas'), 'reuse')
  try {
    s.patch(0, new Float32Array([-32, 16, 1, 0])); s.absent(1, true)
    expect((await s.step(true)).valid).toBe(true)
    const held = (await s.lanes[1].backend.read()).positions.slice(4, 8)
    expect((await s.resize(512)).valid).toBe(true)
    const lane = s.lanes[1]; const identity = lane.backend.resourceIdentity!(); const bytes = lane.footprint().bytes
    const reported = new Map<number, number>()
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const count of [64, 512, 32, 512]) {
        const row = await s.resize(count)
        expect(row.valid).toBe(true); expect(row.reports[1].reused).toBe(true)
        expect(row.reports[1].capacityAfter).toBe(512)
        expect(row.reports[1].copiedBytes).toBe(0); expect(row.reports[1].downloadedBytes).toBe(0)
        expect(lane.backend.resourceIdentity!()).toEqual(identity); expect(lane.footprint().bytes).toBe(bytes)
        expect((await s.step(true)).valid).toBe(true)
        const points = (await lane.backend.read()).positions
        expect(Array.from(points.slice(0, 4))).toEqual([-32, 16, 1, 0])
        expect(differingBits(points.slice(4, 8), held)).toBe(0)
        const total = lane.reportedBufferBytes()
        if (reported.has(count)) expect(total).toBe(reported.get(count))
        reported.set(count, total)
      }
    }
  } finally { s.destroy() }
  expect(s.lanes.every(l => l.footprint().bytes === 0)).toBe(true)
})
native('in-capacity updates allocate no buffers or kernels and overwrite dropped tails on regrowth', async () => {
  const l = await createCapacityLane(document.createElement('canvas'),
    { fixture: 'chain', count: 512, decay: 100, springPrecision: 'trig' }, 'gpu', 'retain')
  try {
    l.patch(511, new Float32Array([1e6, -1e6, 1, 1]))
    const source = l.backend.positionSource!(); const bytes = l.footprint().bytes
    const kernel = vi.spyOn(Kernel, 'createAsync'); const buffer = vi.spyOn(source.device, 'createBuffer')
    try {
      for (const count of [32, 128, 512]) {
        const report = await l.resize(count)
        expect(report.reused).toBe(true); expect(report.peakBytes).toBe(bytes)
      }
      await l.resize(64, false)
      expect(kernel).not.toHaveBeenCalled(); expect(buffer).not.toHaveBeenCalled()
    } finally { kernel.mockRestore(); buffer.mockRestore() }
    expect(differingBits((await l.backend.read()).positions, l.data.input.points)).toBe(0)
    await l.resize(512)
    const tail = (await l.backend.read()).positions.slice(511 * 4)
    expect(Array.from(tail)).toEqual(Array.from(l.data.input.points.slice(511 * 4)))
    expect(tail[2]).toBe(1); expect(tail[3]).toBe(0); expect(tail[0]).not.toBe(1e6)
    expect(l.backend.positionSource!().buffer).toBe(source.buffer)
    const before = (await l.backend.read()).positions
    await expect(l.resize(-1)).rejects.toThrow('4–16384')
    const tooMany = { ...l.data.graph, links: new Float32Array(2048), weights: new Float32Array(1024).fill(1) }
    expect(() => l.backend.resizeGraph!(tooMany, l.data.input, true)).toThrow('Topology capacity exceeded')
    expect(l.backend.positionSource!().count).toBe(512); expect(l.footprint().bytes).toBe(bytes)
    expect(differingBits((await l.backend.read()).positions, before)).toBe(0)
  } finally { l.destroy() }
  expect(l.footprint().bytes).toBe(0)
})
for (const fixture of ['chain', 'communities', 'star'] as const) {
  native(`matches rebuilt ${fixture} after growth, shrink and regrowth under unchanged CPU tolerance`, async () => {
    const s = await createCapacitySession({ fixture, count: 2048, decay: 100, springPrecision: 'trig' },
      () => document.createElement('canvas'), 'reuse')
    try {
      s.patch(0, new Float32Array([-32, 16, 1, 0])); s.absent(1, true)
      let identity: ReturnType<NonNullable<typeof s.lanes[1]['backend']['resourceIdentity']>> | undefined
      for (const count of CAPACITY_CYCLE) {
        const row = await s.resize(count)
        expect(row.valid).toBe(true)
        const current = s.lanes[1].backend.resourceIdentity!()
        if (identity) {
          expect(current).toEqual(identity); expect(row.reports[1].reused).toBe(true)
          expect(row.reports[1].copiedBytes).toBe(0)
        }
        identity = current
        const frame = await s.step(true)
        expect(frame.valid, JSON.stringify(frame)).toBe(true)
        expect(frame.controlTiming?.operations).toBe(1)
      }
      expect(s.rows.filter(r => r.count === 8192).map(r => r.order)).toEqual([[1, 0], [0, 1]])
      expect(s.resizes.every(r => r.reports[1].downloadedBytes === 0)).toBe(true)
    } finally { s.destroy() }
    expect(s.lanes.every(l => l.footprint().bytes === 0)).toBe(true)
  }, 120000)
}
