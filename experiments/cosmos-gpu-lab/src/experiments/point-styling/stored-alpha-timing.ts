import type { Device, RenderPass, RenderPassProps, QuerySet, TimestampQuerySnapshot } from '@luma.gl/core'
import type { WEBGLCommandEncoder } from '@luma.gl/core/webgl'
import { readLumaTimer, type TimerStatus } from '../weighted-links/timing'

export type StoredAlphaStage = 'clear' | 'paint' | 'geometry' | 'resolve'
export type StoredAlphaPassTimer = { begin(props: RenderPassProps, stage: StoredAlphaStage): RenderPass; end(pass: RenderPass): void }
export type StoredAlphaTiming = {
  selectionCpuMs: number; requestWallMs: number;
  mode: 'wall' | 'gpu'; setupCpuMs: number; querySetupCpuMs: number; encodeSubmitCpuMs: number; completionWallMs: number;
  queryReadbackWallMs: number; frameReadbackWallMs?: number; scratchBytes: number;
  gpuMs: number | null; stageGpuMs: Record<StoredAlphaStage, number> | null; timerStatus: TimerStatus; timerDetail?: string;
}
export function createStoredAlphaTimer (device: Device, passCount: number, enabled: boolean): StoredAlphaPassTimer & {
  read(): Promise<Pick<StoredAlphaTiming, 'gpuMs' | 'stageGpuMs' | 'timerStatus' | 'timerDetail'>>; destroy(): void;
} {
  // WebGPU permits at most 4096 entries per QuerySet. Keep adjacent pairs
  // together; multiple query sets do not change the render workload.
  const queries: QuerySet[] = []
  const snapshots = new Map<QuerySet, TimestampQuerySnapshot>()
  try {
    if (enabled && device.features.has('timestamp-query')) {
      for (let first = 0; first < passCount * 2; first += 4096) {
        queries.push(device.createQuerySet({ type: 'timestamp', count: Math.min(4096, passCount * 2 - first) }))
      }
    }
  } catch (error) { queries.forEach(q => q.destroy()); throw error }
  let activeQuery: QuerySet | undefined
  const stages: StoredAlphaStage[] = []
  let activeIndex = -1
  const gl = device.type === 'webgl' ? device.commandEncoder as WEBGLCommandEncoder : undefined
  return {
    begin (props, stage): RenderPass {
      if (activeIndex >= 0) throw new Error('Stored-alpha profiling cannot nest passes')
      const index = stages.length * 2
      if (index >= passCount * 2) throw new Error('Stored-alpha pass count exceeded')
      stages.push(stage); activeIndex = index % 4096
      const query = queries[Math.floor(index / 4096)]; activeQuery = query
      if (query && device.type === 'webgpu' && !snapshots.has(query)) {
        snapshots.set(query, device.commandEncoder.captureTimestampQuerySet!(query))
      }
      // alpha.15 GL pass timestamps omit clear. Public command timestamps
      // enclose the entire pass instead. WebGPU records a pair inside each pass;
      // never subtract counters belonging to different Metal passes.
      if (query && gl) gl.writeTimestamp(query, activeIndex)
      return device.beginRenderPass({
        ...props,
        ...(query && !gl
          ? {
            timestampQuerySet: query, beginTimestampIndex: activeIndex, endTimestampIndex: activeIndex + 1,
          }
          : {}),
      })
    },
    end (pass): void {
      try { pass.end(); if (activeQuery && gl) gl.writeTimestamp(activeQuery, activeIndex + 1) } finally { activeIndex = -1 }
    },
    async read (): Promise<Pick<StoredAlphaTiming, 'gpuMs' | 'stageGpuMs' | 'timerStatus' | 'timerDetail'>> {
      if (!queries.length) return { gpuMs: null, stageGpuMs: null, timerStatus: 'unavailable' }
      let timerDetail: string | undefined
      let sums: Record<StoredAlphaStage, number> | null = null
      const result = await readLumaTimer({
        async readTimestampDuration (): Promise<number> {
          const values = (await Promise.all(queries.map(query => (snapshots.get(query) ?? query).readResults()))).flat()
          if (stages.length !== passCount || values.length !== passCount * 2) { timerDetail = 'Incomplete pass/query results'; return NaN }
          const totals = { clear: 0n, paint: 0n, geometry: 0n, resolve: 0n }
          for (const [i, stage] of stages.entries()) {
            const elapsed = values[i * 2 + 1] - values[i * 2]
            if (elapsed < 0n || (!gl && values[i * 2 + 1] === 0n)) {
              timerDetail = `Invalid ${stage} pair ${i}: ${values[i * 2]} → ${values[i * 2 + 1]}`
              return NaN
            }
            totals[stage] += elapsed
          }
          const total = Object.values(totals).reduce((sum, n) => sum + n, 0n)
          if (total > BigInt(Number.MAX_SAFE_INTEGER)) return NaN
          sums = {
            clear: Number(totals.clear) / 1e6,
            paint: Number(totals.paint) / 1e6,
            geometry: Number(totals.geometry) / 1e6,
            resolve: Number(totals.resolve) / 1e6,
          }
          return Number(total) / 1e6
        },
      })
      return { gpuMs: result.milliseconds, stageGpuMs: result.status === 'valid' ? sums : null, timerStatus: result.status, timerDetail }
    },
    destroy (): void { queries.forEach(q => q.destroy()) },
  }
}
