import type { Device } from '@luma.gl/core'
import type { GridTimestamps } from '../spatial-grid/resources'
export const BATCH_POLICY = { targetMilliseconds: 4, maximumOperations: 64 } as const

export function chooseBatchSize (gpuMilliseconds: number | null, wallMilliseconds: number): number {
  // Zero is a valid quantized GPU result: use the largest batch to resolve short work.
  const estimate = gpuMilliseconds ?? wallMilliseconds
  if (!Number.isFinite(estimate) || estimate < 0) return 1
  if (estimate === 0) return BATCH_POLICY.maximumOperations
  return Math.max(1, Math.min(BATCH_POLICY.maximumOperations, Math.floor(BATCH_POLICY.targetMilliseconds / estimate)))
}

export type TimestampSample = {
  startNanoseconds: string;
  endNanoseconds: string;
  milliseconds: number | null;
}

export function decodeTimestamps (start: bigint, end: bigint): TimestampSample {
  const delta = end - start
  return {
    startNanoseconds: start.toString(),
    endNanoseconds: end.toString(),
    // A GPU counter reset can produce a negative delta. Preserve the raw values.
    milliseconds: delta < 0n || delta > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(delta) / 1e6,
  }
}

export function createGpuTimer (device: Device): {
  writes: (edge?: 'start' | 'end') => GridTimestamps;
  read: () => Promise<TimestampSample>;
  destroy: () => void;
} | undefined {
  if (!device.features.has('timestamp-query')) return undefined
  const query = device.createQuerySet({ type: 'timestamp', count: 2 })
  return {
    writes: edge => ({ timestampQuerySet: query, beginTimestampIndex: edge === 'end' ? undefined : 0, endTimestampIndex: edge === 'start' ? undefined : 1 }),
    async read (): Promise<TimestampSample> {
      const values = await query.readResults({ firstQuery: 0, queryCount: 2 })
      return decodeTimestamps(values[0], values[1])
    },
    destroy (): void { query.destroy() },
  }
}
