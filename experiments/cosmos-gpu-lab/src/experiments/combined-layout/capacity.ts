import { createDevice, readFloats, waitForGpu } from '../../gpu/luma'
import { BufferLedger } from '../../gpu/resource-scope'
import type { PositionTransfer } from '../many-body/backend'
import { createGraph, type Settings } from './data'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'
export const CAPACITY_CYCLE = [8192, 4096, 8192, 2048] as const
export type CapacityPolicy = 'rebuild' | 'retain'
export type BufferFootprint = { bytes: number; buffers: number; lifetimePeakBytes: number }
export type ResizeReport = {
  from: number; count: number; generation: number; preserve: boolean; deviceRetained: boolean;
  preserved: number; copiedBytes: number; uploadedBytes: number; downloadedBytes: number;
  copySubmitMs: number; setupMs: number; completionMs: number;
  before: BufferFootprint; after: BufferFootprint; peakBytes: number;
  reportedBefore: number; reportedPeak: number; reportedAfter: number;
  strategy: 'cpu-rebuild' | 'gpu-rebuild' | 'gpu-retained'; reused: boolean; capacityBefore: number; capacityAfter: number;
}
export type CapacityLane = {
  readonly backend: CombinedBackend; readonly data: ReturnType<typeof createGraph>; readonly count: number; readonly capacity: number;
  info: string; footprint(): BufferFootprint; resize(count: number, preserve?: boolean): Promise<ResizeReport>; destroy(): void;
  reportedBufferBytes(): number;
  patch(index: number, point: Float32Array): void;
}

// Growth creates an exact-size generation. Retained mode reuses that high-water
// allocation and its kernels for later logical counts that fit within it.
export async function createCapacityLane (
  canvas: HTMLCanvasElement, settings: Settings, mode: 'gpu' | 'cpu', policy: CapacityPolicy = 'rebuild'
): Promise<CapacityLane> {
  let data = createGraph(settings)
  const pins = new Set<number>()
  for (let i = 0; i < settings.count; i++) if (data.input.points[i * 4 + 2] > 0.5) pins.add(i)
  if (settings.count > 16384) throw new Error('Capacity experiment supports 4–16384 points')
  if (mode === 'cpu' && policy === 'retain') throw new Error('Retained capacity requires the resident GPU path')
  let capacity = settings.count
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
      get capacity (): number { return capacity },
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
        const before = footprint(); const reportedBefore = reportedBufferBytes(); const capacityBefore = capacity; ledger.begin()
        let candidate: CombinedBackend | undefined; let downloadedBytes = 0
        try {
          const kept = preserve ? Math.min(source.count, count) : 0
          const reused = policy === 'retain' && count <= capacity
          if (mode === 'cpu' && kept) {
            const prefix = await readFloats(source.buffer, kept * 16)
            next.input.points.set(prefix); downloadedBytes = prefix.byteLength
          }
          const setupStart = performance.now()
          let transfer: PositionTransfer
          if (reused) transfer = backend!.resizeGraph!(next.graph, next.input, preserve)
          else {
            candidate = await createCombinedWebGPU(canvas, next.graph, next.input, settings.springPrecision, {
              gpuBounds: mode === 'gpu', context, preserve: mode === 'gpu' && kept ? source : undefined,
            })
            transfer = candidate.positionTransfer!
          }
          const setupMs = performance.now() - setupStart
          await waitForGpu(device); check()
          const peakBytes = ledger.transactionPeakBytes
          const reportedPeak = reportedBufferBytes()
          const deviceRetained = source.device === (candidate ?? backend!).positionSource!().device
          if (candidate) {
            const previous = backend!; backend = candidate; candidate = undefined; capacity = count; generation++
            previous.destroy()
          }
          data = next
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
            strategy: mode === 'cpu' ? 'cpu-rebuild' : policy === 'retain' ? 'gpu-retained' : 'gpu-rebuild',
            reused,
            capacityBefore,
            capacityAfter: capacity,
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
