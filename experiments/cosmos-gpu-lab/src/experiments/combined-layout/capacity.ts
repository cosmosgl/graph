import { createDevice, readFloats, waitForGpu } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import { createGraph, type Settings } from './data'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'
export const CAPACITY_CYCLE = [8192, 4096, 8192, 2048] as const
export type BufferFootprint = { bytes: number; buffers: number; lifetimePeakBytes: number }
export type ResizeReport = {
  from: number; count: number; generation: number; preserve: boolean; deviceRetained: boolean;
  preserved: number; copiedBytes: number; uploadedBytes: number; downloadedBytes: number;
  copySubmitMs: number; setupMs: number; completionMs: number;
  before: BufferFootprint; after: BufferFootprint; peakBytes: number;
  reportedBefore: number; reportedPeak: number; reportedAfter: number;
}
export type CapacityLane = {
  readonly backend: CombinedBackend; readonly data: ReturnType<typeof createGraph>; readonly count: number;
  info: string; footprint(): BufferFootprint; resize(count: number, preserve?: boolean): Promise<ResizeReport>; destroy(): void;
  reportedBufferBytes(): number;
  patch(index: number, point: Float32Array): void;
}

// Exact-size generations establish ownership and transfer semantics first.
// Every generation borrows ONE device; only this lane destroys that device.
export async function createCapacityLane (
  canvas: HTMLCanvasElement, settings: Settings, mode: 'gpu' | 'cpu'
): Promise<CapacityLane> {
  let data = createGraph(settings)
  const pins = new Set<number>()
  for (let i = 0; i < settings.count; i++) if (data.input.points[i * 4 + 2] > 0.5) pins.add(i)
  if (settings.count > 16384) throw new Error('Capacity experiment supports 4–16384 points')
  let failure: string | undefined; let destroyed = false; let busy = false; let generation = 0
  const device = await createDevice('webgpu', canvas, true, error => { failure = error.message })
  const ledger = new BufferLedger()
  const reportedBufferBytes = (): number => device.statsManager.getStats('GPU Time and Memory').get('Buffer Memory').count
  const check = (): void => { if (destroyed || failure || device.isLost) throw new Error(failure ?? 'Capacity device lost or destroyed') }
  const context = { device, ledger, check }
  const footprint = (): BufferFootprint => ({ bytes: ledger.liveBytes, buffers: ledger.liveBuffers, lifetimePeakBytes: ledger.peakBytes })
  let backend: CombinedBackend | undefined
  try {
    backend = await createCombinedWebGPU(canvas, data.graph, data.input, settings.springPrecision, { gpuBounds: mode === 'gpu', context })
    return {
      get backend (): CombinedBackend { check(); return backend! },
      get data (): ReturnType<typeof createGraph> { return data },
      get count (): number { return data.input.points.length / 4 },
      info: backend.info,
      footprint,
      reportedBufferBytes,
      patch (index, point): void {
        check()
        if (busy) throw new Error('Capacity update already in progress')
        backend!.patchPositions!(index, point)
        for (let i = 0; i < point.length / 4; i++) {
          if (point[i * 4 + 2] > 0.5) pins.add(index + i)
          else pins.delete(index + i)
        }
      },
      async resize (count, preserve = true): Promise<ResizeReport> {
        check()
        if (busy) throw new Error('Capacity update already in progress')
        if (!Number.isInteger(count) || count < 4 || count > 16384) throw new Error('Capacity experiment supports 4–16384 points')
        // Validate CPU arrays before touching the old generation.
        const next = createGraph({ ...settings, count })
        // Cosmos retains its CPU pinned-index set across data rebuilds, even
        // when a pinned index is temporarily outside the current point count.
        for (let i = 0; i < count; i++) next.input.points[i * 4 + 2] = pins.has(i) ? 1 : 0
        busy = true; const start = performance.now(); const source = backend!.positionSource!()
        const before = footprint(); const reportedBefore = reportedBufferBytes(); ledger.begin()
        let candidate: CombinedBackend | undefined; let downloadedBytes = 0
        try {
          const kept = preserve ? Math.min(source.count, count) : 0
          if (mode === 'cpu' && kept) {
            const prefix = await readFloats(source.buffer, kept * 16)
            next.input.points.set(prefix); downloadedBytes = prefix.byteLength
          }
          const setupStart = performance.now()
          candidate = await createCombinedWebGPU(canvas, next.graph, next.input, settings.springPrecision, {
            gpuBounds: mode === 'gpu', context, preserve: mode === 'gpu' && kept ? source : undefined,
          })
          const setupMs = performance.now() - setupStart
          await waitForGpu(device); check()
          const peakBytes = ledger.transactionPeakBytes
          const reportedPeak = reportedBufferBytes()
          const transfer = candidate.positionTransfer!
          const deviceRetained = source.device === candidate.positionSource!().device
          const previous = backend!; backend = candidate; candidate = undefined; data = next; generation++
          previous.destroy()
          return {
            from: source.count,
            count,
            generation,
            preserve,
            deviceRetained,
            preserved: kept,
            copiedBytes: transfer.copiedBytes,
            uploadedBytes: transfer.uploadedBytes,
            downloadedBytes,
            copySubmitMs: transfer.copySubmitMs,
            setupMs,
            completionMs: performance.now() - start,
            before,
            after: footprint(),
            peakBytes,
            reportedBefore,
            reportedPeak,
            reportedAfter: reportedBufferBytes(),
          }
        } finally { candidate?.destroy(); busy = false }
      },
      destroy (): void {
        if (destroyed) return
        destroyed = true
        try { backend?.destroy() } finally { device.destroy() }
      },
    }
  } catch (error) {
    try { backend?.destroy() } finally { device.destroy() }
    throw error
  }
}
