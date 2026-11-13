import type { Device } from '@luma.gl/core'
import type { ComputeScope } from '../many-body/backend'
import type { Measurement, TimestampWrites } from '../many-body/timing'
import { waitForGpu } from '../../gpu/luma'
import { readLumaTimer } from '../weighted-links/timing'
export const PROFILE_STAGES = [
  'gravity.force', 'gravity.integration', 'repulsion.bounds', 'repulsion.bin', 'repulsion.aggregate',
  'repulsion.samples', 'repulsion.centroids', 'repulsion.far', 'repulsion.resolve', 'repulsion.integration',
  'incoming.force', 'incoming.integration', 'outgoing.force', 'outgoing.integration', 'draw',
] as const
export type StageTiming = { name: typeof PROFILE_STAGES[number]; gpuMs: number | null }
export type StageMeasurement = { timing: Measurement; stages: StageTiming[] }
// Only subtract the adjacent endpoints of ONE pass, never across passes.
export function stageDurations (values: bigint[], pairs: number): number[] | null {
  if (values.length !== pairs * 2) return null
  const durations: number[] = []
  for (let i = 0; i < pairs; i++) {
    const n = values[i * 2 + 1] - values[i * 2]; const ms = Number(n) / 1e6
    if (n < 0n || !Number.isFinite(ms)) return null
    durations.push(ms)
  }
  return durations
}
export async function measureGpuStages (
  device: Device, encode: (scope: ComputeScope, draw: () => TimestampWrites) => void
): Promise<StageMeasurement> {
  await waitForGpu(device)
  const query = device.features.has('timestamp-query') ? device.createQuerySet({ type: 'timestamp', count: PROFILE_STAGES.length * 2 }) : undefined
  const stages: StageTiming[] = []; let durations: number[] | null = null
  const timestamps = (name: string): TimestampWrites => {
    const index = stages.length
    if (PROFILE_STAGES[index] !== name) throw new Error(`Unexpected profile stage ${name}; expected ${PROFILE_STAGES[index]}`)
    stages.push({ name: PROFILE_STAGES[index], gpuMs: null })
    return query ? { timestampQuerySet: query, beginTimestampIndex: index * 2, endTimestampIndex: index * 2 + 1 } : {}
  }
  try {
    const start = performance.now()
    encode((name, work) => {
      const pass = device.beginComputePass(timestamps(name))
      try { work(pass) } finally { pass.end() }
    }, () => timestamps('draw'))
    if (stages.length !== PROFILE_STAGES.length) throw new Error('Incomplete profile stage sequence')
    device.submit(); const submitted = performance.now()
    await waitForGpu(device); const complete = performance.now()
    const result = query
      ? await readLumaTimer({
        async readTimestampDuration (): Promise<number> {
          durations = stageDurations(await query.readResults({ firstQuery: 0, queryCount: stages.length * 2 }), stages.length)
          return durations ? durations.reduce((a, b) => a + b, 0) : NaN
        },
      })
      : { milliseconds: null, status: 'unavailable' as const }
    if (result.status === 'valid' && durations) stages.forEach((stage, i) => { stage.gpuMs = durations![i] })
    return {
      stages,
      timing: {
        operations: 1,
        batchSubmitMs: submitted - start,
        batchCompletionMs: complete - start,
        batchGpuMs: result.milliseconds,
        timerStatus: result.status,
      },
    }
  } finally { query?.destroy() }
}
