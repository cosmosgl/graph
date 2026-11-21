import { createFixture, PARAMETERS, type Fixture } from '../many-body/data'
import { chooseOperations, summarize, TIMING_POLICY, type Measurement, type Stage } from '../many-body/timing'
import { centroidReference, centroidRounding, type CentroidMode } from './centroids'
import { createGridWebGPU } from './webgpu'
import type { GridBackend } from './backend'
import { buildReference, frameFor } from './data'
import { comparePresent, gridReference } from './reference'
import { compareStructure } from './validation'
import { farResources } from './far-resources'
export const PRECISION_MODES = ['inline', 'materialized', 'streamed'] as const satisfies readonly CentroidMode[]
export type PrecisionMode = typeof PRECISION_MODES[number]
export const MODE_LABELS: Record<PrecisionMode, string> = {
  inline: 'Inline control', materialized: 'Stored contributions', streamed: 'Streamed contributions',
}
export type PrecisionTimingRow = {
  fixture: Fixture; count: number; stage: Stage; mode: PrecisionMode; device: string;
  frame: { bounds: number[]; seed: number; slots: number; precise: boolean };
  operations: number; samples: Measurement[]; validation: ReturnType<typeof comparePresent>[];
  structure: ReturnType<typeof compareStructure> | null; centroidDifferences: number | null;
  extraStorageBytes: number; extraDispatches: number;
  summary: ReturnType<typeof summarize> | null;
}
export async function runPrecisionSweep (options: {
  rows: PrecisionTimingRow[]; fixtures?: Fixture[]; counts?: number[];
  cancelled(): boolean; progress(message: string): void;
}): Promise<void> {
  const { rows, cancelled, progress } = options
  for (const fixture of options.fixtures ?? ['uniform', 'clusters']) {
    for (const count of options.counts ?? [8192, 16384]) {
      if (cancelled()) return
      const input = createFixture(fixture, count); const frame = frameFor(input.points, 0)
      const referenceStructure = buildReference(input.points, frame)
      const expected = gridReference(input, input.points, PARAMETERS, frame, referenceStructure)
      const lanes: GridBackend[] = []
      try {
        for (const mode of PRECISION_MODES) {
          if (cancelled()) return
          progress(`${fixture} · ${count} · preparing ${MODE_LABELS[mode]}`)
          lanes.push(await createGridWebGPU(document.createElement('canvas'), input, PARAMETERS, frame, mode))
        }
        for (const stage of ['force', 'step'] as const) {
          const reference = stage === 'force' ? { forces: expected.forces, positions: input.points } : expected
          const stageRows = PRECISION_MODES.map((mode, i): PrecisionTimingRow => ({
            fixture,
            count,
            stage,
            mode,
            device: lanes[i].info,
            frame: { ...frame, bounds: Array.from(frame.bounds) },
            operations: 1,
            samples: [],
            validation: [],
            structure: null,
            centroidDifferences: null,
            summary: null,
            ...farResources(count, mode),
          }))
          rows.push(...stageRows)
          const run = async (i: number, operations: number): Promise<Measurement> => {
            const { timing, snapshot } = await lanes[i].measure(stage, operations).catch(error => {
              const context = `${MODE_LABELS[PRECISION_MODES[i]]} / ${fixture} / ${count} / ${stage} / batch ${operations}`
              throw new Error(`${context}: ${error instanceof Error ? error.message : String(error)}`)
            })
            const row = stageRows[i]; const validation = comparePresent(snapshot, reference, input.points)
            row.validation.push(validation)
            // The inline control's known CPU mismatch stays visible. It is not an eligible replacement.
            if (!validation.valid && row.mode !== 'inline') throw new Error(`${MODE_LABELS[row.mode]} failed ${fixture}/${count}/${stage}; sweep stopped`)
            if (!row.structure || row.samples.length === TIMING_POLICY.samples - 1) {
              const structure = await lanes[i].readStructure()
              row.structure = compareStructure(structure, referenceStructure)
              if (!row.structure.valid) throw new Error(`${MODE_LABELS[row.mode]} structure validation failed`)
              if (row.mode !== 'inline') {
                row.centroidDifferences = centroidRounding(await lanes[i].readCentroids!(), centroidReference(structure)).differingComponents
                if (row.centroidDifferences) throw new Error(`${MODE_LABELS[row.mode]} centroid validation failed`)
              }
            }
            return timing.timerStatus === 'valid' && !(timing.batchGpuMs! > 0)
              ? { ...timing, batchGpuMs: null, timerStatus: 'invalid' }
              : timing
          }
          const pilots: Measurement[] = []
          for (let i = 0; i < lanes.length; i++) {
            if (cancelled()) return
            progress(`${fixture} · ${count} · ${stage} · ${MODE_LABELS[PRECISION_MODES[i]]} · pilot`)
            pilots.push(await run(i, 1))
          }
          const operations = chooseOperations(pilots)
          stageRows.forEach(row => { row.operations = operations })
          for (let round = 0; round < TIMING_POLICY.warmups + TIMING_POLICY.samples; round++) {
            for (let offset = 0; offset < lanes.length; offset++) {
              if (cancelled()) return
              const i = (round + offset) % lanes.length
              const sampling = round >= TIMING_POLICY.warmups
              progress(`${fixture} · ${count} · ${stage === 'force' ? 'grid + force' : 'complete step'} · ${MODE_LABELS[PRECISION_MODES[i]]} · ` +
                `${sampling ? `sample ${round - TIMING_POLICY.warmups + 1}/7` : `warmup ${round + 1}/2`} · batch ${operations}`)
              const sample = await run(i, operations)
              if (sampling) stageRows[i].samples.push(sample)
              await new Promise(resolve => setTimeout(resolve, 0))
            }
          }
          stageRows.forEach(row => { row.summary = summarize(row.samples) })
        }
      } finally { lanes.reverse().forEach(lane => lane.destroy()) }
    }
  }
}
