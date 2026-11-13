import type { Backend } from './backend'
import { createFixture, PARAMETERS, type Fixture } from './data'
import { compare, referenceTick } from './reference'
import { createWebGL } from './webgl'
import { createWebGPU } from './webgpu'
import { chooseOperations, summarize, TIMING_POLICY, type Measurement, type Stage } from './timing'

export type BenchmarkRow = {
  fixture: Fixture;
  count: number;
  stage: Stage;
  backend: string;
  device: string;
  operations: number;
  samples: Measurement[];
  validation: ReturnType<typeof compare>[];
  summary: ReturnType<typeof summarize> | null;
}
export type SweepOptions = {
  fixtures: Fixture[];
  counts?: readonly number[];
  rows: BenchmarkRow[];
  cancelled(): boolean;
  progress(message: string): void;
}
// Separate devices keep demo state untouched. Lanes run serially with a completion fence;
// rotate their order between rounds to avoid always giving one backend a warmer GPU.
export async function runSweep ({ fixtures, counts = TIMING_POLICY.counts, cancelled, progress, rows }: SweepOptions): Promise<void> {
  for (const fixture of fixtures) {
    for (const count of counts) {
      if (cancelled()) return
      const input = createFixture(fixture, count)
      const expectedStep = referenceTick(input, input.points, PARAMETERS)
      const expectedForce = { forces: expectedStep.forces, positions: input.points }
      const lanes: Backend[] = []
      try {
        progress(`${fixture} · ${count.toLocaleString()} points · preparing three backends`)
        const canvas = (): HTMLCanvasElement => {
          const value = document.createElement('canvas'); value.width = 480; value.height = 340; return value
        }
        lanes.push(await createWebGL(canvas(), input, PARAMETERS))
        if (cancelled()) return
        lanes.push(await createWebGPU(canvas(), input, PARAMETERS, 'direct'))
        if (cancelled()) return
        lanes.push(await createWebGPU(canvas(), input, PARAMETERS, 'tiled'))
        for (const stage of ['force', 'step'] as const) {
          if (cancelled()) return
          const expected = stage === 'force' ? expectedForce : expectedStep
          const stageRows: BenchmarkRow[] = lanes.map(backend => ({
            fixture,
            count,
            stage,
            backend: backend.name,
            device: backend.info,
            operations: 1,
            samples: [] as Measurement[],
            validation: [] as ReturnType<typeof compare>[],
            summary: null,
          } satisfies BenchmarkRow))
          rows.push(...stageRows)
          const run = async (index: number, operations: number): Promise<Measurement> => {
            const result = await lanes[index].measure(stage, operations)
            const check = compare(result.snapshot, expected)
            stageRows[index].validation.push(check)
            if (!check.valid) throw new Error(`${lanes[index].name}: ${fixture} / ${count} / ${stage} validation failed; sweep stopped`)
            return result.timing
          }
          const pilot: Measurement[] = []
          for (let i = 0; i < lanes.length; i++) {
            if (cancelled()) return
            pilot.push(await run(i, 1))
          }
          const operations = chooseOperations(pilot)
          stageRows.forEach(row => { row.operations = operations })
          for (let round = 0; round < TIMING_POLICY.warmups + TIMING_POLICY.samples; round++) {
            for (let offset = 0; offset < lanes.length; offset++) {
              if (cancelled()) return
              const i = (round + offset) % lanes.length
              const sampling = round >= TIMING_POLICY.warmups
              const roundLabel = sampling
                ? `sample ${round - TIMING_POLICY.warmups + 1}/${TIMING_POLICY.samples}`
                : `warmup ${round + 1}/${TIMING_POLICY.warmups}`
              progress(`${fixture} · ${count.toLocaleString()} points · ${stage === 'force' ? 'force' : 'force + integration'} · ` +
                `${lanes[i].name} · ${roundLabel} · batch ${operations}`)
              const sample = await run(i, operations)
              if (sampling) stageRows[i].samples.push(sample)
              // Yield between samples so Stop / route disposal can interrupt a long sweep.
              await new Promise(resolve => setTimeout(resolve, 0))
            }
          }
          stageRows.forEach((row: BenchmarkRow) => { row.summary = summarize(row.samples) })
        }
      } finally { lanes.reverse().forEach(lane => lane.destroy()) }
    }
  }
}
