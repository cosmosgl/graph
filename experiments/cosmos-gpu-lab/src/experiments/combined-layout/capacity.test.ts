import { expect, it, vi } from 'vitest'
import { Kernel } from '@luma.gl/engine'
import { createCapacitySession } from './capacity-session'
import { createCapacityLane, CAPACITY_CYCLE } from './capacity'
import { differingBits } from './resident'
const native = it.skipIf(!import.meta.env.LAB_NATIVE_GPU)
native('repeated resize cycles retain device, pinning and absence while releasing previous generations', async () => {
  const s = await createCapacitySession({ fixture: 'chain', count: 32, decay: 100, springPrecision: 'trig' },
    () => document.createElement('canvas'))
  const devices = s.lanes.map(l => l.backend.positionSource!().device)
  const footprints = new Map<number, number>()
  const reported = new Map<number, number>()
  try {
    s.patch(0, new Float32Array([-32, 16, 1, 0])); s.absent(1, true)
    expect((await s.step(true)).valid).toBe(true)
    const held = (await s.lanes[1].backend.read()).positions.slice(4, 8)
    for (let repeat = 0; repeat < 3; repeat++) {
      for (const count of [128, 64, 128, 32]) {
        const tick = s.tick(); const alpha = s.alpha()
        const old = s.lanes.map(l => l.backend.positionSource!().buffer)
        const row = await s.resize(count)
        expect(row.valid).toBe(true); expect(s.tick()).toBe(tick); expect(s.alpha()).toBe(alpha)
        expect(old.every(b => b.destroyed)).toBe(true)
        for (const [i, lane] of s.lanes.entries()) expect(lane.backend.positionSource!().device).toBe(devices[i])
        const report = row.reports[1]
        expect(report.copiedBytes).toBe(Math.min(count, report.from) * 32)
        expect(report.uploadedBytes).toBe(Math.max(0, count - report.from) * 32)
        expect(report.downloadedBytes).toBe(0)
        expect(report.peakBytes).toBe(report.before.bytes + report.after.bytes)
        if (footprints.has(count)) expect(report.after.bytes).toBe(footprints.get(count))
        footprints.set(count, report.after.bytes)
        expect((await s.step(true)).valid).toBe(true)
        const points = (await s.lanes[1].backend.read()).positions
        const bytes = s.lanes[1].reportedBufferBytes()
        if (reported.has(count)) expect(bytes).toBe(reported.get(count))
        reported.set(count, bytes)
        expect(Array.from(points.slice(0, 4))).toEqual([-32, 16, 1, 0])
        expect(differingBits(points.slice(4, 8), held)).toBe(0)
      }
    }
    s.absent(1, false); expect((await s.step(true)).valid).toBe(true)
    await expect(s.resize(20000)).rejects.toThrow('4–16384')
    expect((await s.step(true)).valid).toBe(true)
  } finally { s.destroy() }
  expect(s.lanes.every(l => l.footprint().bytes === 0 && l.footprint().buffers === 0)).toBe(true)
  for (const device of devices) expect((await device.lost).reason).toBe('destroyed')
})
native('regrowth initializes dropped tail records and full replacement is authoritative', async () => {
  const l = await createCapacityLane(document.createElement('canvas'), { fixture: 'chain', count: 128, decay: 100, springPrecision: 'trig' }, 'gpu')
  try {
    l.patch(127, new Float32Array([333, 444, 1, 1]))
    await l.resize(32); await l.resize(128)
    const restored = (await l.backend.read()).positions
    expect(Array.from(restored.slice(127 * 4))).toEqual(Array.from(l.data.input.points.slice(127 * 4)))
    expect(restored[127 * 4 + 2]).toBe(1); expect(restored[127 * 4 + 3]).toBe(0)
    expect(restored[127 * 4]).not.toBe(333)
    l.patch(0, new Float32Array([-32, 16, 1, 0]))
    const report = await l.resize(64, false)
    expect(report.copiedBytes).toBe(0); expect(report.preserved).toBe(0)
    expect(differingBits((await l.backend.read()).positions, l.data.input.points)).toBe(0)
    expect((await l.backend.read()).positions[2]).toBe(1)
    const before = l.backend.positionSource!()
    await expect(l.resize(-1)).rejects.toThrow('4–16384')
    expect(l.backend.positionSource!().buffer).toBe(before.buffer)
  } finally { l.destroy() }
  expect(l.footprint().bytes).toBe(0)
})
native('failed generation setup releases its buffers and leaves the borrowed device and old state usable', async () => {
  const l = await createCapacityLane(document.createElement('canvas'), { fixture: 'chain', count: 32, decay: 100, springPrecision: 'trig' }, 'gpu')
  try {
    const source = l.backend.positionSource!(); const before = (await l.backend.read()).positions
    const footprint = l.footprint().bytes; const reported = l.reportedBufferBytes()
    const create = vi.spyOn(Kernel, 'createAsync').mockRejectedValueOnce(new Error('Test setup failure'))
    try { await expect(l.resize(128)).rejects.toThrow('Test setup failure') } finally { create.mockRestore() }
    expect(l.count).toBe(32); expect(l.footprint().bytes).toBe(footprint)
    expect(l.reportedBufferBytes()).toBe(reported)
    expect(l.backend.positionSource!().buffer).toBe(source.buffer)
    expect(source.buffer.destroyed).toBe(false); expect(source.device.isLost).toBe(false)
    expect(differingBits((await l.backend.read()).positions, before)).toBe(0)
    l.backend.stepTick!(1, 0)
    expect((await l.backend.read()).positions.every(Number.isFinite)).toBe(true)
  } finally { l.destroy() }
  expect(l.footprint().bytes).toBe(0)
})
native('runs the 2048–8192–4096 capacity cycle with unchanged CPU tolerance and no resident resize readback', async () => {
  const s = await createCapacitySession({ fixture: 'communities', count: 2048, decay: 100, springPrecision: 'trig' },
    () => document.createElement('canvas'))
  try {
    s.patch(0, new Float32Array([-32, 16, 1, 0])); s.absent(1, true)
    expect((await s.step(true)).valid).toBe(true)
    for (const count of CAPACITY_CYCLE) {
      expect((await s.resize(count)).valid).toBe(true)
      const row = await s.step(true)
      expect(row.valid, JSON.stringify(row)).toBe(true)
    }
    expect(s.resizes.every(r => r.reports[1].downloadedBytes === 0)).toBe(true)
  } finally { s.destroy() }
  expect(s.lanes[1].footprint().bytes).toBe(0)
}, 120000)
