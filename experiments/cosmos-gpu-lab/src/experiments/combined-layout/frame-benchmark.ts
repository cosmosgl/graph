import { fitView } from '../many-body/backend'
import { summarize, type Measurement } from '../many-body/timing'
import type { Snapshot } from '../many-body/reference'
import { frameFor } from '../many-body-grid/data'
import { cool, createGraph, STAGES, type Settings, type SpringPrecision } from './data'
import { differingBits } from './resident'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'

export const FRAME_POLICY = {
  targetBatchMs: 12,
  minFrames: 4,
  maxFrames: 16,
  warmups: 2,
  samples: 7,
  width: 480,
  height: 340,
  gpuMetric: 'sum of per-pass timestamp pairs',
  submissions: 'one per frame',
} as const
export type FrameCheck = { positions: number; forces: number; finite: boolean; valid: boolean }
export type FrameTimingRow = {
  mode: SpringPrecision; draw: boolean; frames: number; info: string; samples: Measurement[]; checks: FrameCheck[];
  summary?: ReturnType<typeof summarize>; error?: string;
}
export function frameBatchSize (pilots: Measurement[]): number {
  const slowest = Math.max(...pilots.map(p => (p.batchGpuMs ?? p.batchCompletionMs) / p.operations))
  return !Number.isFinite(slowest) || slowest <= 0
    ? FRAME_POLICY.minFrames
    : Math.max(FRAME_POLICY.minFrames, Math.min(FRAME_POLICY.maxFrames, Math.floor(FRAME_POLICY.targetBatchMs / slowest)))
}
function compare (actual: Snapshot, expected: Snapshot): FrameCheck {
  const positions = differingBits(actual.positions, expected.positions); const forces = differingBits(actual.forces, expected.forces)
  const finite = actual.positions.every(Number.isFinite) && actual.forces.every(Number.isFinite)
  return { positions, forces, finite, valid: finite && positions === 0 && forces === 0 }
}

// All rows replay the SAME initial inputs and number of evolving frames. No
// uploads, readbacks, CPU force oracle or reference waits occur inside the batch.
export async function benchmarkResidentFrames (options: {
  settings: Settings; rows: FrameTimingRow[]; cancelled(): boolean; progress(message: string): void;
}): Promise<void> {
  const { settings, rows, cancelled, progress } = options
  if (cancelled()) return
  const { graph, input } = createGraph(settings); const view = fitView([input.points]); view[2] /= 2; view[3] /= 2
  const canvas = (): HTMLCanvasElement => { const c = document.createElement('canvas'); c.width = FRAME_POLICY.width; c.height = FRAME_POLICY.height; return c }
  const modes = ['baseline', 'trig'] as const
  const cache = new Map<SpringPrecision, Map<number, Snapshot>>()
  for (const mode of modes) {
    cache.set(mode, new Map())
    for (const draw of [false, true]) rows.push({ mode, draw, frames: 1, info: '', samples: [], checks: [] })
  }
  const expectedFor = async (backend: CombinedBackend, mode: SpringPrecision, frames: number): Promise<Snapshot> => {
    const expected = cache.get(mode)!; const cached = expected.get(frames); if (cached) return cached
    backend.setPositions(input.points); let alpha = 1
    // Reuse one device for a CPU-bounds replay BEFORE resetting for the timed run.
    for (let tick = 0; tick < frames; tick++) {
      for (const stage of STAGES) {
        if (stage === 'repulsion') backend.setFrame(frameFor((await backend.read()).positions, tick))
        backend.stepStage(stage, alpha)
      }
      alpha = cool(alpha, settings.decay)
    }
    const result = await backend.read(); expected.set(frames, result); return result
  }
  const run = async (backend: CombinedBackend, row: FrameTimingRow, frames: number): Promise<Measurement> => {
    const expected = await expectedFor(backend, row.mode, frames)
    const result = await backend.measureFrames!({ frames, draw: row.draw, decay: settings.decay, view })
    const check = compare(result.snapshot, expected); row.checks.push(check)
    if (!check.valid) throw new Error(`Frame replay differs: ${JSON.stringify(check)}`)
    return result.timing
  }
  const pilots: Measurement[] = []; let frames = 1
  // Keep only ONE benchmark device alive. Calibrate both modes before choosing
  // a common batch size; recreate outside the interval for warmed measurements.
  for (const pilot of [true, false]) {
    for (const mode of pilot ? modes : [...modes].reverse()) {
      if (cancelled()) return
      const selected = rows.filter(r => r.mode === mode && !r.error); if (!selected.length) continue
      progress(`Preparing ${mode} frame kernels…`)
      const backend = await createCombinedWebGPU(canvas(), graph, input, mode, { gpuBounds: true })
      try {
        selected.forEach(r => { r.info = backend.info; r.frames = frames })
        const rounds = pilot ? 1 : FRAME_POLICY.warmups + FRAME_POLICY.samples
        for (let round = 0; round < rounds; round++) {
          for (let i = 0; i < selected.length; i++) {
            if (cancelled()) return
            const row = selected[(i + round) % selected.length]; if (row.error) continue
            progress(`${pilot ? 'Calibrating' : round < FRAME_POLICY.warmups ? 'Warming' : 'Timing'} ${mode} · ` +
              `${row.draw ? 'frame' : 'simulation'} · ${frames} frames · round ${round + 1}/${rounds}`)
            try {
              const measurement = await run(backend, row, frames)
              if (pilot) pilots.push(measurement)
              else if (round >= FRAME_POLICY.warmups) row.samples.push(measurement)
              if (row.samples.length) row.summary = summarize(row.samples)
            } catch (error) { row.error = String(error) }
            await new Promise(resolve => setTimeout(resolve, 0))
          }
        }
      } finally { backend.destroy() }
    }
    if (pilot) frames = frameBatchSize(pilots)
  }
}
