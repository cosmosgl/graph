import type { Device, QuerySet } from '@luma.gl/core'
import type { WEBGLCommandEncoder } from '@luma.gl/webgl'
import { waitForGpu } from '../../gpu/luma'
import { readLumaTimer, type TimerStatus } from '../weighted-links/timing'

export type Stage = 'force' | 'step'
export const TIMING_POLICY = { counts: [128, 512, 1024, 2048, 4096], targetBatchMs: 6, minOperations: 4, maxOperations: 64, warmups: 2, samples: 7 } as const
export type Measurement = {
  operations: number;
  batchSubmitMs: number;
  batchCompletionMs: number;
  batchGpuMs: number | null;
  timerStatus: TimerStatus;
}
export type TimestampWrites = { timestampQuerySet?: QuerySet; beginTimestampIndex?: number; endTimestampIndex?: number }
export function timestamps (query: QuerySet | undefined, begin: boolean, end: boolean): TimestampWrites {
  return query && (begin || end) ? { timestampQuerySet: query, beginTimestampIndex: begin ? 0 : undefined, endTimestampIndex: end ? 1 : undefined } : {}
}
export function validateBatch (operations: number): void {
  if (!Number.isInteger(operations) || operations < 1 || operations > TIMING_POLICY.maxOperations) throw new Error('Batch must contain 1–64 operations')
}
export function chooseOperations (samples: Measurement[]): number {
  const slowest = Math.max(...samples.map(s => (s.batchGpuMs ?? s.batchCompletionMs) / s.operations))
  if (!Number.isFinite(slowest) || slowest < 0) return 1
  if (slowest === 0) return TIMING_POLICY.maxOperations
  return Math.max(TIMING_POLICY.minOperations, Math.min(TIMING_POLICY.maxOperations, Math.floor(TIMING_POLICY.targetBatchMs / slowest)))
}
export function median (values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
}
export function summarize (samples: Measurement[]): { gpuMs: number | null; gpuRange: [number, number] | null; completionMs: number; submitMs: number } {
  const gpu = samples.map(s => s.batchGpuMs === null ? null : s.batchGpuMs / s.operations)
  const valid = samples.length === TIMING_POLICY.samples && samples.every(s => s.timerStatus === 'valid') &&
    gpu.every(n => n !== null && Number.isFinite(n) && n >= 0)
  const values = gpu as number[]
  return {
    gpuMs: valid ? median(values) : null,
    gpuRange: valid ? [Math.min(...values), Math.max(...values)] : null,
    completionMs: median(samples.map(s => s.batchCompletionMs / s.operations)),
    submitMs: median(samples.map(s => s.batchSubmitMs / s.operations)),
  }
}
// Uploads, preceding work, query readback and validation are outside the interval.
// A fresh query per batch avoids reusing unresolved or invalid timestamp slots.
export async function measureBatch (
  device: Device, operations: number, encode: (query: QuerySet | undefined, first: boolean, last: boolean) => void
): Promise<Measurement> {
  validateBatch(operations)
  await waitForGpu(device)
  const query = device.features.has('timestamp-query') ? device.createQuerySet({ type: 'timestamp', count: 2 }) : undefined
  try {
    const start = performance.now()
    // WebGL pass timestamps begin after clear in alpha.4. Use luma command
    // timestamps there so the first clear is included like all subsequent clears.
    const commandTimestamps = device.type === 'webgl' && query !== undefined
    if (commandTimestamps) (device.commandEncoder as WEBGLCommandEncoder).writeTimestamp(query, 0)
    for (let i = 0; i < operations; i++) encode(commandTimestamps ? undefined : query, i === 0, i === operations - 1)
    if (commandTimestamps) (device.commandEncoder as WEBGLCommandEncoder).writeTimestamp(query, 1)
    device.submit()
    const submitted = performance.now()
    await waitForGpu(device)
    const complete = performance.now()
    const result = query ? await readLumaTimer(query) : { milliseconds: null, status: 'unavailable' as const }
    return { operations, batchSubmitMs: submitted - start, batchCompletionMs: complete - start, batchGpuMs: result.milliseconds, timerStatus: result.status }
  } finally { query?.destroy() }
}
