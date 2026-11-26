import { readLumaTimer, type TimerStatus } from '../weighted-links/timing'
import type { Snapshot } from '../many-body/reference'
import type { Workload } from './data'
import { type Integrated, type IntegratedSpring, type FrameTrace, nextFrame } from './runtime'
import { percentiles, interactionCheck } from './evaluate'
import { validateFrame, fit } from './validation'
export const gpuTimingProtocol = 'Selected graph and point count, seed 29471, 960 × 600 CSS px at recorded DPR. ' +
  'Four reset windows: timestamps off / on / on / off. Each advances 60 warmup ticks, fits once, then measures 300 full frames. ' +
  'Read timestamps and validate after each window; keep completion pacing, forces, colors and acceptance gates unchanged. ' +
  'The 8,192-point sweep runs chain, communities and star in that order, with four windows for each graph.'
export const hubComparisonProtocol = '8,192 star, chain, communities; hoist / prefetch / prefetch / hoist with timestamps off, then on. ' +
  'Each resets, warms 60 ticks, fits and measures 300 complete frames; ordered prefetch threshold 1,024. ' +
  'Require exact control position, force and color bits before interactions. Original frame, feedback and rendering gates stay unchanged.'
export const gpuLargeMatrix = (['chain', 'communities', 'star'] as const).map(kind => ({ kind, count: 8192 }))
type Sample = FrameTrace & { intervalMs: number }
export type GpuTimingRow = {
  gpuTiming: true; window: number; instrumented: boolean; info: string; viewport: number[]; recordedAt: string;
  springOptimization: IntegratedSpring; fixture: Workload; pointCount: number; linkCount: number; repulsionMethod: string;
  samples: Sample[]; frames: ReturnType<typeof percentiles>; within33: number;
  completionWait: ReturnType<typeof percentiles>;
  gpu: { status: TimerStatus | 'not measured'; simulationMs: number[] | null; drawingMs: number[] | null; totalMs: number[] | null; error?: string };
  sameState: { positions: boolean; forces: boolean; colors?: boolean };
  validation: Awaited<ReturnType<typeof validateFrame>>;
  interactions: Awaited<ReturnType<typeof interactionCheck>>;
}
const sameBits = (a: Float32Array, b: Float32Array): boolean => {
  const av = new Uint32Array(a.buffer, a.byteOffset, a.length); const bv = new Uint32Array(b.buffer, b.byteOffset, b.length)
  return av.length === bv.length && av.every((v, i) => v === bv[i])
}
export function gpuTimingVerdict (r: GpuTimingRow): string {
  const i = r.interactions; const v = r.validation
  const passes = (!r.instrumented || r.gpu.status === 'valid') && r.sameState.positions && r.sameState.forces && r.sameState.colors !== false &&
    r.within33 >= 0.95 && i.pick.max <= 50 && i.activePick.max <= 50 && i.drag.max <= 50 &&
    i.exactIds && i.dragPinned && i.pause && i.resume && i.resize && v.finite && v.paintedSamples > 0 &&
    v.interiorIdFailures === 0 && v.interiorColorFailures === 0 && v.invisiblePicks === 0
  return passes ? 'Pass within sampled scope' : 'Not accepted'
}
export async function profileGpuTiming (
  r: Integrated, cancelled: () => boolean, progress: (text: string) => void, record: (row: GpuTimingRow) => void,
  input: { kind: Workload; count: number; hubComparison?: boolean } = { kind: 'communities', count: 1024 }
): Promise<void> {
  const device = r.backend.positionSource!().device
  if (!device.features.has('timestamp-query')) throw new Error('GPU timestamps unavailable on this device; no wall-clock substitution')
  let hidden = document.visibilityState !== 'visible'; let baseline: Snapshot | undefined; let baselineColor: Uint8Array | undefined
  const visibility = (): void => { hidden ||= document.visibilityState !== 'visible' }
  const guard = (): void => {
    if (cancelled()) throw new Error('Cancelled; completed GPU timing windows retained')
    if (hidden || document.visibilityState !== 'visible') throw new Error('GPU timing window invalidated: tab became hidden')
  }
  document.addEventListener('visibilitychange', visibility)
  try {
    r.pause(); r.resize(960, 600, devicePixelRatio)
    const windows = input.hubComparison
      ? [false, true].flatMap(instrumented => (['hoist', 'prefetch', 'prefetch', 'hoist'] as const).map(optimization => ({ instrumented, optimization })))
      : [false, true, true, false].map(instrumented => ({ instrumented, optimization: 'hoist' as const }))
    for (const [index, { instrumented, optimization }] of windows.entries()) {
      guard(); progress(`${input.kind} ${input.kind === 'karate' ? 34 : input.count} · GPU timing ${index + 1}/${windows.length} · ` +
        `${optimization} · timestamps ${instrumented ? 'on' : 'off'}`)
      await r.replace(input.kind, input.count, optimization)
      for (let i = 0; i < 60; i++) { guard(); await nextFrame(); await r.frame(true) }
      fit(r, (await r.backend.read()).positions); await r.frame(false)
      const query = instrumented ? device.createQuerySet({ type: 'timestamp', count: 1200 }) : undefined
      const samples: Sample[] = []
      let gpu: GpuTimingRow['gpu'] = { status: 'not measured', simulationMs: null, drawingMs: null, totalMs: null }
      try {
        let previous = await nextFrame()
        for (let i = 0; i < 300; i++) {
          guard(); const trace: FrameTrace = { encodeSimulationMs: 0, encodeDrawMs: 0, completionWaitMs: 0 }
          await r.frame(true, trace, query ? { query, offset: i * 4 } : undefined)
          const stamp = await nextFrame(); samples.push({ ...trace, intervalMs: stamp - previous }); previous = stamp
        }
        // Adjacent endpoints belong to the SAME pass. Never subtract across compute/render passes.
        if (query) {
          const simulationMs: number[] = []; const drawingMs: number[] = []
          try {
            const result = await readLumaTimer({
              async readTimestampDuration (): Promise<number> {
                const values = await query.readResults({ firstQuery: 0, queryCount: 1200 })
                if (values.length !== 1200) return NaN
                for (let i = 0; i < 300; i++) {
                  const simulation = values[i * 4 + 1] - values[i * 4]; const drawing = values[i * 4 + 3] - values[i * 4 + 2]
                  if (simulation < 0n || drawing < 0n) return NaN
                  simulationMs.push(Number(simulation) / 1e6); drawingMs.push(Number(drawing) / 1e6)
                }
                return simulationMs.reduce((sum, value, i) => sum + value + drawingMs[i], 0)
              },
            })
            gpu = result.status === 'valid'
              ? { status: 'valid', simulationMs, drawingMs, totalMs: simulationMs.map((v, i) => v + drawingMs[i]) }
              : { status: result.status, simulationMs: null, drawingMs: null, totalMs: null }
          } catch (error) {
            gpu = { status: 'invalid', simulationMs: null, drawingMs: null, totalMs: null, error: String(error) }
          }
        }
      } finally { query?.destroy() }
      guard(); const snapshot = await r.backend.read(); baseline ??= snapshot
      const sameState: GpuTimingRow['sameState'] = {
        positions: sameBits(baseline.positions, snapshot.positions), forces: sameBits(baseline.forces, snapshot.forces),
      }
      if (input.hubComparison) {
        const color = (await r.renderer.snapshot()).color; baselineColor ??= color
        sameState.colors = baselineColor.length === color.length && baselineColor.every((v, i) => v === color[i])
      }
      const interactions = await interactionCheck(r); guard(); const validation = await validateFrame(r); guard()
      record({
        gpuTiming: true,
        springOptimization: optimization,
        fixture: input.kind,
        pointCount: r.data.input.points.length / 4,
        linkCount: r.data.graph.links.length / 2,
        repulsionMethod: r.backend.repulsionMethod?.() ?? 'unknown',
        window: index + 1,
        instrumented,
        info: r.info,
        viewport: [r.canvas.width, r.canvas.height, r.renderer.ratio],
        recordedAt: new Date().toISOString(),
        samples,
        frames: percentiles(samples.map(s => s.intervalMs)),
        within33: samples.filter(s => s.intervalMs <= 33).length / samples.length,
        completionWait: percentiles(samples.map(s => s.completionWaitMs)),
        gpu,
        sameState,
        validation,
        interactions,
      })
    }
  } finally { r.pause(); document.removeEventListener('visibilitychange', visibility) }
}
