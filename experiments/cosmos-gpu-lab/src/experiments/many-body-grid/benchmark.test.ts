import { afterEach, expect, it, vi } from 'vitest'
import type { GridBackend } from './backend'
import { createGridWebGPU } from './webgpu'
import { runPrecisionSweep, type PrecisionTimingRow } from './benchmark'
import { buildReference } from './data'
import { gridReference } from './reference'
import { centroidReference, type CentroidMode } from './centroids'
vi.mock('./webgpu', () => ({ createGridWebGPU: vi.fn() }))
let calls: string[] = []; let disposals: string[] = []
function setup (bad?: CentroidMode, duration = 1): void {
  vi.mocked(createGridWebGPU).mockImplementation(async (_canvas, input, p, frame, mode = 'inline') => {
    const structure = buildReference(input.points, frame)
    const expected = gridReference(input, input.points, p, frame, structure)
    return {
      name: mode,
      info: 'test device',
      setPositions (): void {},
      setFrame (): void {},
      step (): void {},
      render (): void {},
      async read (): Promise<never> { throw new Error('Not needed') },
      async readStructure (): ReturnType<GridBackend['readStructure']> { return structure },
      async readCentroids (): Promise<Float32Array> { return centroidReference(structure) },
      async measure (stage, operations): ReturnType<GridBackend['measure']> {
        calls.push(mode)
        const forces = expected.forces.slice(); if (bad === mode) forces[0] += 1
        return {
          snapshot: { forces, positions: stage === 'force' ? input.points : expected.positions },
          timing: { operations, batchGpuMs: operations * duration, batchCompletionMs: operations * 2, batchSubmitMs: 0.1, timerStatus: 'valid' },
        }
      },
      destroy (): void { disposals.push(mode) },
    }
  })
}
afterEach(() => { vi.clearAllMocks(); calls = []; disposals = [] })
it('rotates order with a common batch, validates warmups, and labels a failing inline control without hiding it', async () => {
  setup('inline'); const rows: PrecisionTimingRow[] = []
  await runPrecisionSweep({ rows, fixtures: ['uniform'], counts: [8], cancelled: () => false, progress: () => {} })
  expect(rows).toHaveLength(6)
  for (const row of rows) {
    expect(row.operations).toBe(6); expect(row.samples).toHaveLength(7); expect(row.validation).toHaveLength(10)
    expect(row.validation.every(v => v.valid)).toBe(row.mode !== 'inline')
    expect(row.summary?.gpuMs).toBe(1)
    expect(row.structure?.valid).toBe(true)
    if (row.mode !== 'inline') expect(row.centroidDifferences).toBe(0)
  }
  expect(calls.slice(3, 9)).toEqual(['inline', 'materialized', 'streamed', 'materialized', 'streamed', 'inline'])
  expect(disposals).toHaveLength(3)
})
it('stops on a failed precision candidate and releases devices without producing a clean summary', async () => {
  setup('streamed'); const rows: PrecisionTimingRow[] = []
  await expect(runPrecisionSweep({ rows, fixtures: ['uniform'], counts: [8], cancelled: () => false, progress: () => {} })).rejects.toThrow('sweep stopped')
  expect(rows[2].validation[0].valid).toBe(false)
  expect(rows.every(row => row.summary === null)).toBe(true)
  expect(disposals).toHaveLength(3)
})
it('retains partial samples on cancellation and destroys all temporary backends', async () => {
  setup(); const rows: PrecisionTimingRow[] = []
  await runPrecisionSweep({ rows, fixtures: ['uniform'], counts: [8], cancelled: () => calls.length >= 11, progress: () => {} })
  expect(calls).toHaveLength(11)
  expect(rows.reduce((n, row) => n + row.samples.length, 0)).toBe(2)
  expect(rows.every(row => row.summary === null)).toBe(true)
  expect(disposals).toHaveLength(3)
})

it('keeps zero-duration GPU samples invalid instead of reporting free computation', async () => {
  setup(undefined, 0); const rows: PrecisionTimingRow[] = []
  await runPrecisionSweep({ rows, fixtures: ['uniform'], counts: [8], cancelled: () => false, progress: () => {} })
  for (const row of rows) {
    expect(row.samples.every(sample => sample.timerStatus === 'invalid' && sample.batchGpuMs === null)).toBe(true)
    expect(row.summary?.gpuMs).toBeNull()
    expect(row.summary?.completionMs).toBe(2)
  }
})
