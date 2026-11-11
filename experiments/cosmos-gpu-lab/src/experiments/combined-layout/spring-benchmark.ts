import { frameFor } from '../many-body-grid/data'
import { compareArray } from '../weighted-links/reference'
import { compareArray as compareStage } from '../many-body/reference'
import { chooseOperations, summarize, TIMING_POLICY, type Measurement } from '../many-body/timing'
import { createGraph, PRECISION_MODES, STAGES, type Stage, type Settings, type SpringPrecision } from './data'
import { createOracle } from './reference'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'
export type SpringTimingRow = {
  fixture: Settings['fixture']; count: number; mode: SpringPrecision; stage: Stage; phase: 'force' | 'step';
  device?: string; operations: number; samples: Measurement[];
  checks: Array<{ forces: ReturnType<typeof compareArray>; positions: ReturnType<typeof compareArray> }>;
  summary: ReturnType<typeof summarize> | null; error?: string;
}
export type SpringTimingOptions = {
  settings: Settings; modes?: readonly SpringPrecision[];
  stages?: readonly Stage[]; rows: SpringTimingRow[]; cancelled(): boolean; progress(message: string): void;
}
// Initial CPU stage inputs are identical across modes, independent of the live demo.
// Repeated measurements never swap the source positions: each operation is the same directional spring evaluation.
export async function benchmarkSprings ({
  settings, modes = PRECISION_MODES, stages = ['incoming', 'outgoing'], rows, cancelled, progress,
}: SpringTimingOptions): Promise<void> {
  const { graph, input } = createGraph(settings); const oracle = createOracle(graph, input)
  let points = input.points
  const lanes: Array<{ mode: SpringPrecision; backend?: CombinedBackend; error?: string }> = []
  try {
    for (const mode of modes) {
      if (cancelled()) return
      progress(`Preparing ${mode} GPU arithmetic…`)
      const lane: typeof lanes[number] = { mode }; lanes.push(lane)
      try { lane.backend = await createCombinedWebGPU(document.createElement('canvas'), graph, input, mode) } catch (error) { lane.error = String(error) }
    }
    for (const stage of STAGES) {
      const expected = oracle.stage(stage, points, 1, 1)
      if (!stages.includes(stage)) { points = expected.positions; continue }
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
            const result = lane.backend.measureStage
              ? await lane.backend.measureStage(stage, 1, phase, operations)
              : (stage === 'incoming' || stage === 'outgoing') && lane.backend.measureSpring
                ? await lane.backend.measureSpring(stage, 1, phase, operations)
                : undefined
            if (!result) throw new Error('Stage timing is unavailable')
            const compare = stage === 'incoming' || stage === 'outgoing' ? compareArray : compareStage
            row.checks.push({
              forces: compare(result.snapshot.forces, expected.forces),
              positions: compare(result.snapshot.positions, phase === 'force' ? points : expected.positions),
            })
            return result.timing
          } catch (error) { row.error = String(error); lane.error = row.error; return undefined }
        }
        for (const [i, lane] of lanes.entries()) {
          if (cancelled()) return
          if (!batchRows[i].error) {
            try {
              lane.backend?.setPositions(points)
              if (stage === 'repulsion') lane.backend?.setFrame(frameFor(points, 1))
            } catch (error) { batchRows[i].error = lane.error = String(error) }
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
