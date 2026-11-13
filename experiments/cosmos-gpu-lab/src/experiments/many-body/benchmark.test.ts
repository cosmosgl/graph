import { afterEach, expect, it, vi } from 'vitest'
import { createWebGL } from './webgl'
import { createWebGPU } from './webgpu'
import { runSweep, type BenchmarkRow } from './benchmark'
import { referenceTick } from './reference'
import type { Backend } from './backend'
import type { Input } from './data'
import { PARAMETERS } from './data'
vi.mock('./webgl', () => ({ createWebGL: vi.fn() }))
vi.mock('./webgpu', () => ({ createWebGPU: vi.fn() }))
let calls: string[] = []
let disposals: string[] = []
function mockBackends (bad = false): void {
  const backend = (name: string, input: Input): Backend => ({
    name,
    info: name,
    setPositions (): void {},
    step (): void {},
    render (): void {},
    async read (): Promise<never> { throw new Error('Not needed') },
    async measure (stage, operations): ReturnType<Backend['measure']> {
      calls.push(name)
      const expected = referenceTick(input, input.points, PARAMETERS)
      if (bad && name === 'tiled') expected.forces[0] += 1
      return {
        timing: { operations, batchSubmitMs: 0.1, batchCompletionMs: operations * 2, batchGpuMs: operations, timerStatus: 'valid' },
        snapshot: { forces: expected.forces, positions: stage === 'step' ? expected.positions : input.points },
      }
    },
    destroy (): void { disposals.push(name) },
  })
  vi.mocked(createWebGL).mockImplementation(async (_canvas, input) => backend('WebGL', input))
  vi.mocked(createWebGPU).mockImplementation(async (_canvas, input, _p, variant) => backend(variant, input))
}
afterEach(() => { vi.clearAllMocks(); calls = []; disposals = [] })
it('uses a common batch, rotates order, validates warmups and completes both workloads', async () => {
  mockBackends()
  const rows: BenchmarkRow[] = []
  await runSweep({ fixtures: ['uniform'], counts: [8], rows, cancelled: () => false, progress: () => {} })
  expect(rows).toHaveLength(6)
  for (const row of rows) {
    expect(row.operations).toBe(6)
    expect(row.samples).toHaveLength(7)
    expect(row.validation).toHaveLength(10)
    expect(row.summary?.gpuMs).toBe(1)
  }
  expect(calls.slice(3, 9)).toEqual(['WebGL', 'direct', 'tiled', 'direct', 'tiled', 'WebGL'])
  expect(disposals.sort()).toEqual(['WebGL', 'direct', 'tiled'])
})
it('stops on a numerical failure and releases every backend without reporting a timing summary', async () => {
  mockBackends(true)
  const rows: BenchmarkRow[] = []
  await expect(runSweep({ fixtures: ['uniform'], counts: [8], rows, cancelled: () => false, progress: () => {} })).rejects.toThrow('validation failed')
  expect(rows.every(row => row.summary === null)).toBe(true)
  expect(rows[2].validation[0].valid).toBe(false)
  expect(disposals).toHaveLength(3)
})
it('cancels between batches and keeps partial records', async () => {
  mockBackends()
  const rows: BenchmarkRow[] = []
  await runSweep({ fixtures: ['uniform'], counts: [8], rows, cancelled: () => calls.length >= 11, progress: () => {} })
  expect(calls).toHaveLength(11)
  expect(rows.reduce((sum, row) => sum + row.samples.length, 0)).toBe(2)
  expect(rows.every(row => row.summary === null)).toBe(true)
  expect(disposals).toHaveLength(3)
})
