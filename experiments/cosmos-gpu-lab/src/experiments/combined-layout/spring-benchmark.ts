import { compareArray } from '../weighted-links/reference'
import { chooseOperations, summarize, TIMING_POLICY, type Measurement } from '../many-body/timing'
import { createGraph, PRECISION_MODES, type Settings, type SpringPrecision } from './data'
import { createOracle } from './reference'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'
export type SpringTimingRow = {
  fixture: Settings['fixture']; count: number; mode: SpringPrecision; stage: 'incoming' | 'outgoing'; phase: 'force' | 'step';
  device?: string; operations: number; samples: Measurement[];
  checks: Array<{ forces: ReturnType<typeof compareArray>; positions: ReturnType<typeof compareArray> }>;
  summary: ReturnType<typeof summarize> | null; error?: string;
}
export type SpringTimingOptions = {
  settings: Settings; modes?: readonly SpringPrecision[]; rows: SpringTimingRow[]; cancelled(): boolean; progress(message: string): void;
}
// Initial CPU stage inputs are identical across modes, independent of the live demo.
// Repeated measurements never swap the source positions: each operation is the same directional spring evaluation.
export async function benchmarkSprings ({ settings, modes = PRECISION_MODES, rows, cancelled, progress }: SpringTimingOptions): Promise<void> {
  const { graph, input } = createGraph(settings); const oracle = createOracle(graph, input)
  let points = oracle.stage('gravity', input.points, 1, 1).positions
  points = oracle.stage('repulsion', points, 1, 1).positions
  const lanes: Array<{ mode: SpringPrecision; backend?: CombinedBackend; error?: string }> = []
  try {
    for (const mode of modes) {
      if (cancelled()) return
      progress(`Preparing ${mode} spring arithmetic…`)
      const lane: typeof lanes[number] = { mode }; lanes.push(lane)
      try { lane.backend = await createCombinedWebGPU(document.createElement('canvas'), graph, input, mode) } catch (error) { lane.error = String(error) }
    }
    for (const stage of ['incoming', 'outgoing'] as const) {
      const expected = oracle.stage(stage, points, 1, 1)
      for (const phase of ['force', 'step'] as const) {
        if (cancelled()) return
        const batchRows: SpringTimingRow[] = lanes.map(lane => ({
          fixture: settings.fixture,
          count: settings.count,
          mode: lane.mode,
          stage,
          phase,
          device: lane.backend?.info,
          operations: 1,
          samples: [],
          checks: [],
          summary: null,
          ...(lane.error ? { error: lane.error } : {}),
        }))
        rows.push(...batchRows)
        const run = async (i: number, operations: number): Promise<Measurement | undefined> => {
          const row = batchRows[i]; const lane = lanes[i]
          if (row.error || !lane.backend) return undefined
          try {
            if (!lane.backend.measureSpring) throw new Error('Spring timing is unavailable')
            const result = await lane.backend.measureSpring(stage, 1, phase, operations)
            row.checks.push({
              forces: compareArray(result.snapshot.forces, expected.forces),
              positions: compareArray(result.snapshot.positions, phase === 'force' ? points : expected.positions),
            })
            return result.timing
          } catch (error) { row.error = String(error); lane.error = row.error; return undefined }
        }
        for (const [i, lane] of lanes.entries()) {
          if (cancelled()) return
          if (!batchRows[i].error) {
            try { lane.backend?.setPositions(points) } catch (error) { batchRows[i].error = lane.error = String(error) }
          }
          const pilot = await run(i, 1)
          // Per-mode batch size prevents an expensive control from shortening every cheap candidate's timer interval.
          if (pilot) batchRows[i].operations = chooseOperations([pilot])
        }
        for (let round = 0; round < TIMING_POLICY.warmups + TIMING_POLICY.samples; round++) {
          for (let offset = 0; offset < lanes.length; offset++) {
            if (cancelled()) return
            const i = (round + offset) % lanes.length; const row = batchRows[i]
            progress(`${settings.fixture} · ${settings.count} · ${stage} · ${phase} · ${row.mode} · round ${round + 1}/9`)
            const sample = await run(i, row.operations)
            if (sample && round >= TIMING_POLICY.warmups) row.samples.push(sample)
            // Preserve complete rows even if a later row is cancelled or rejected.
            if (row.samples.length === TIMING_POLICY.samples && !row.error) row.summary = summarize(row.samples)
            await new Promise(resolve => setTimeout(resolve, 0))
          }
        }
      }
      points = expected.positions
    }
  } finally { lanes.reverse().forEach(l => l.backend?.destroy()) }
}
