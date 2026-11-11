import { expect, it } from 'vitest'
import type { Measurement } from '../many-body/timing'
import { benchmarkResidentFrames, frameBatchSize, type FrameTimingRow } from './frame-benchmark'
it('bounds frame batches using the slowest elapsed interval and completion fallback', () => {
  const sample = (gpu: number | null, completion: number): Measurement => ({
    operations: 1, batchGpuMs: gpu, batchCompletionMs: completion, batchSubmitMs: 0, timerStatus: gpu === null ? 'unavailable' : 'valid',
  })
  expect(frameBatchSize([sample(1, 2), sample(4, 6)])).toBe(4)
  expect(frameBatchSize([sample(null, 20)])).toBe(4)
  expect(frameBatchSize([sample(1, 2)])).toBe(12)
  expect(frameBatchSize([sample(0.01, 1)])).toBe(16)
})
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('times full batches and validates every output against the staged replay', async () => {
  const rows: FrameTimingRow[] = []
  await benchmarkResidentFrames({ settings: { fixture: 'star', count: 128, decay: 100 }, rows, cancelled: () => false, progress: () => {} })
  expect(rows).toHaveLength(4)
  expect(new Set(rows.map(r => r.frames)).size).toBe(1)
  for (const row of rows) {
    expect(row.error, JSON.stringify(rows)).toBeUndefined(); expect(row.samples).toHaveLength(7); expect(row.checks).toHaveLength(10)
    expect(row.checks.every(c => c.valid)).toBe(true)
    expect(row.summary?.submitMs).toBeGreaterThan(0)
    expect(row.summary?.completionMs).toBeGreaterThan(0)
    if (row.samples.every(s => s.timerStatus === 'unavailable')) expect(row.summary?.gpuMs).toBeNull()
    else expect(row.summary?.gpuMs).not.toBeNull()
  }
  const partial: FrameTimingRow[] = []
  await benchmarkResidentFrames({
    settings: { fixture: 'chain', count: 128, decay: 100 },
    rows: partial,
    cancelled: () => true,
    progress: () => {},
  })
  expect(partial).toEqual([])
})
