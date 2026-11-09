import type { Measurement, Stage } from './backend'
export const STAGES: Stage[] = ['force', 'integration', 'render', 'tick']
export const TIMING_POLICY = { targetBatchMs: 6, maxOperations: 64, warmups: 2, samples: 7, trajectoryTicks: 25 } as const
export type TimerStatus = 'valid' | 'unavailable' | 'disjoint' | 'timeout' | 'invalid'
export function normalizeMeasurement (
  stage: Stage, operations: number, submit: number, completion: number, gpu: number | null, timerStatus: TimerStatus
): Measurement {
  if (!Number.isInteger(operations) || operations < 1 || operations > TIMING_POLICY.maxOperations) throw new Error('Invalid batch size')
  const valid = gpu !== null && Number.isFinite(gpu) && gpu >= 0 && timerStatus === 'valid'
  return {
    stage,
    operations,
    submitMs: submit / operations,
    completionMs: completion / operations,
    gpuMs: valid ? gpu / operations : null,
    batchSubmitMs: submit,
    batchCompletionMs: completion,
    batchGpuMs: valid ? gpu : null,
    timerStatus: valid ? 'valid' : timerStatus === 'valid' ? 'invalid' : timerStatus,
  }
}
export function chooseOperations (samples: Measurement[]): number {
  const slowest = Math.max(...samples.map(s => s.gpuMs ?? s.completionMs))
  if (!Number.isFinite(slowest) || slowest < 0) return 1
  if (slowest === 0) return TIMING_POLICY.maxOperations
  return Math.max(1, Math.min(TIMING_POLICY.maxOperations, Math.floor(TIMING_POLICY.targetBatchMs / slowest)))
}
export function median (values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
}
// Null means unavailable, not zero. Never drop bad samples and call the remaining subset a clean GPU result.
export function gpuMedian (samples: Measurement[]): number | null {
  return samples.length && samples.every(s => s.gpuMs !== null) ? median(samples.map(s => s.gpuMs!)) : null
}
// The pinned luma QuerySet reports disjoint results by rejection. Bound its polling lifetime;
// cancellation/destruction must never turn an unfinished query into a valid zero-duration sample.
export async function readLumaTimer (
  query: Pick<import('@luma.gl/core').QuerySet, 'readTimestampDuration'>, timeoutMs = 5000
): Promise<{ milliseconds: number | null; status: TimerStatus }> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise(resolve => setTimeout(resolve, 0))
    return await Promise.race([
      query.readTimestampDuration(0, 1).then(milliseconds => ({
        milliseconds: Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : null,
        status: Number.isFinite(milliseconds) && milliseconds >= 0 ? 'valid' as const : 'invalid' as const,
      })),
      new Promise<{ milliseconds: null; status: 'timeout' }>(resolve => {
        timeout = setTimeout(() => resolve({ milliseconds: null, status: 'timeout' }), timeoutMs)
      }),
    ])
  } catch (error) {
    if (error instanceof Error && /disjoint/i.test(error.message)) return { milliseconds: null, status: 'disjoint' }
    throw error
  } finally { if (timeout !== undefined) clearTimeout(timeout) }
}
