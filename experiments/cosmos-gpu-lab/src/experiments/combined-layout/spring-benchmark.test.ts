import { afterEach, expect, it, vi } from 'vitest'
import { benchmarkSprings, type SpringTimingRow } from './spring-benchmark'
import { createCombinedWebGPU } from './webgpu'
import { createOracle } from './reference'
import type { CombinedBackend } from './backend'
import { PRECISION_MODES } from './data'
vi.mock('./webgpu', () => ({ createCombinedWebGPU: vi.fn() }))
let destroyed = 0
function setup (unavailable = false, invalid = false): void {
  vi.mocked(createCombinedWebGPU).mockImplementation(async (_canvas, graph, input) => {
    let points = input.points
    const oracle = createOracle(graph, input)
    const unused = (): never => { throw new Error('Unexpected live simulation work') }
    return {
      name: 'mock',
      info: 'test timer',
      setPositions: (next): void => { points = next },
      step: unused,
      stepStage: unused,
      measure: unused,
      read: unused,
      render: unused,
      setFrame: unused,
      readStructure: unused,
      async measureSpring (stage, alpha, phase, operations): ReturnType<NonNullable<CombinedBackend['measureSpring']>> {
        const snapshot = oracle.stage(stage, points, alpha, 1)
        if (invalid) snapshot.forces[0] += 1
        if (phase === 'force') snapshot.positions = points
        return {
          snapshot,
          timing: {
            operations,
            batchGpuMs: unavailable ? null : operations * 0.1,
            batchCompletionMs: operations * 0.2,
            batchSubmitMs: 0.1,
            timerStatus: unavailable ? 'unavailable' : 'valid',
          },
        }
      },
      destroy (): void { destroyed++ },
    }
  })
}
afterEach(() => { vi.clearAllMocks(); destroyed = 0 })
const settings = { fixture: 'star' as const, count: 8, decay: 100 }
it('times both directions and phases, validates every batch and destroys independent devices', async () => {
  setup(); const rows: SpringTimingRow[] = []
  await benchmarkSprings({ settings, rows, cancelled: () => false, progress: () => {} })
  expect(rows).toHaveLength(PRECISION_MODES.length * 4)
  expect(rows.every(r => r.samples.length === 7 && r.checks.length === 10 && r.checks.every(c => c.forces.valid && c.positions.valid))).toBe(true)
  expect(rows.every(r => r.summary?.gpuMs === 0.1 && r.operations === 60)).toBe(true)
  expect(destroyed).toBe(PRECISION_MODES.length)
})
it('keeps unavailable timestamps distinct from CPU completion and retains setup errors', async () => {
  setup(true); vi.mocked(createCombinedWebGPU).mockRejectedValueOnce(new Error('Test pipeline unavailable'))
  const rows: SpringTimingRow[] = []
  await benchmarkSprings({ settings, rows, cancelled: () => false, progress: () => {} })
  expect(rows.filter(r => r.error)).toHaveLength(4)
  expect(rows.filter(r => !r.error).every(r => r.summary?.gpuMs === null && r.summary?.completionMs === 0.2)).toBe(true)
  expect(destroyed).toBe(PRECISION_MODES.length - 1)
})
it('cancellation retains partial evidence and destroys all prepared devices', async () => {
  setup(); const rows: SpringTimingRow[] = []; let cancelled = false
  await benchmarkSprings({ settings, rows, cancelled: () => cancelled, progress: message => { if (message.includes('round 3/9')) cancelled = true } })
  expect(rows).toHaveLength(PRECISION_MODES.length)
  expect(rows.some(r => r.samples.length === 1)).toBe(true)
  expect(rows.every(r => r.summary === null)).toBe(true)
  expect(destroyed).toBe(PRECISION_MODES.length)
})

it('retains numerical failures alongside valid timings without accepting the candidate', async () => {
  setup(false, true); const rows: SpringTimingRow[] = []
  await benchmarkSprings({ settings, rows, cancelled: () => false, progress: () => {} })
  expect(rows.every(r => r.summary?.gpuMs === 0.1)).toBe(true)
  expect(rows.every(r => r.checks.every(c => !c.forces.valid))).toBe(true)
})
