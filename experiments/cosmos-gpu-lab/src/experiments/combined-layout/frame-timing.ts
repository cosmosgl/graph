import type { Device, QuerySet } from '@luma.gl/core'
import { waitForGpu } from '../../gpu/luma'
import type { Measurement } from '../many-body/timing'
import { validateBatch } from '../many-body/timing'
import { readLumaTimer } from '../weighted-links/timing'

// Each adjacent pair belongs to ONE pass. Sum compute + render pairs per frame;
// do not subtract timestamps across passes on the tested Metal path.
export async function measureFrameBatch (
  device: Device, frames: number, pairsPerFrame: 1 | 2, encode: (query: QuerySet | undefined, frame: number) => void
): Promise<Measurement> {
  validateBatch(frames)
  await waitForGpu(device)
  const pairs = frames * pairsPerFrame
  const query = device.features.has('timestamp-query') ? device.createQuerySet({ type: 'timestamp', count: pairs * 2 }) : undefined
  try {
    const start = performance.now()
    for (let i = 0; i < frames; i++) { encode(query, i); device.submit() }
    const submitted = performance.now()
    await waitForGpu(device)
    const complete = performance.now()
    const result = query
      ? await readLumaTimer({
        async readTimestampDuration (): Promise<number> {
          const values = await query.readResults({ firstQuery: 0, queryCount: pairs * 2 })
          if (values.length !== pairs * 2) return NaN
          let elapsed = 0n
          for (let i = 0; i < pairs; i++) {
            const duration = values[i * 2 + 1] - values[i * 2]
            if (duration < 0n) return NaN
            elapsed += duration
          }
          return Number(elapsed) / 1e6
        },
      })
      : { milliseconds: null, status: 'unavailable' as const }
    return {
      operations: frames,
      batchSubmitMs: submitted - start,
      batchCompletionMs: complete - start,
      batchGpuMs: result.milliseconds,
      timerStatus: result.status,
    }
  } finally { query?.destroy() }
}
