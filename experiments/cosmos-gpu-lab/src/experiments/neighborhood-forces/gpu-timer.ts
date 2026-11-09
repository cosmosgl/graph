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

export function createGpuTimer (device: GPUDevice): {
  writes: (edge?: 'start' | 'end') => GPUComputePassTimestampWrites;
  read: () => Promise<TimestampSample>;
  destroy: () => void;
} | undefined {
  if (!device.features.has('timestamp-query')) return undefined
  const querySet = device.createQuerySet({ type: 'timestamp', count: 2 })
  const resolve = device.createBuffer({ size: 16, usage: 0x0200 | 0x0004 })
  const readback = device.createBuffer({ size: 16, usage: 0x0008 | 0x0001 })
  return {
    writes: edge => ({
      querySet,
      beginningOfPassWriteIndex: edge === 'end' ? undefined : 0,
      endOfPassWriteIndex: edge === 'start' ? undefined : 1,
    }),
    async read (): Promise<TimestampSample> {
      // Resolve in a separate submission, after the wall-time sample has ended.
      const encoder = device.createCommandEncoder()
      encoder.resolveQuerySet(querySet, 0, 2, resolve, 0)
      encoder.copyBufferToBuffer(resolve, 0, readback, 0, 16)
      device.queue.submit([encoder.finish()])
      try {
        await readback.mapAsync(1)
        const values = new BigUint64Array(readback.getMappedRange())
        return decodeTimestamps(values[0], values[1])
      } finally { readback.unmap() }
    },
    destroy (): void { querySet.destroy(); resolve.destroy(); readback.destroy() },
  }
}
