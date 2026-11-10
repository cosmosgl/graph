import { describe, expect, it } from 'vitest'
import { chooseOperations, summarize, type Measurement } from './timing'
const sample = (gpu: number | null = 6): Measurement => ({
  operations: 3, batchGpuMs: gpu, batchCompletionMs: 12, batchSubmitMs: 1, timerStatus: gpu === null ? 'unavailable' : 'valid',
})
describe('many-body timing interpretation', () => {
  it('calibrates all lanes to a common bounded batch using the slowest operation', () => {
    expect(chooseOperations([sample(3), sample(6)])).toBe(4)
    expect(chooseOperations([sample(0)])).toBe(64)
    expect(chooseOperations([sample(null)])).toBe(4)
    expect(chooseOperations([sample(100)])).toBe(4)
  })
  it('never silently drops an invalid or missing GPU sample and retains a real zero', () => {
    const samples = Array.from({ length: 7 }, () => sample())
    expect(summarize(samples)).toMatchObject({ gpuMs: 2, gpuRange: [2, 2], completionMs: 4 })
    expect(summarize(samples.slice(1)).gpuMs).toBeNull()
    samples[3] = sample(null)
    expect(summarize(samples).gpuMs).toBeNull()
    samples[3] = { ...sample(), timerStatus: 'disjoint' }
    expect(summarize(samples).gpuMs).toBeNull()
    expect(summarize(Array.from({ length: 7 }, () => sample(0))).gpuMs).toBe(0)
  })
})
