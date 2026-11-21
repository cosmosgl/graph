import type { Input, Parameters } from '../many-body/data'
import type { Snapshot } from '../many-body/reference'
import type { GridBackend } from './backend'
import type { Frame, Structure } from './data'
import { comparePresent, gridReference } from './reference'
import { createTrace, traceChecks, type Trace } from './trace'
export async function diagnose (
  backend: GridBackend, normal: Snapshot, input: Input, points: Float32Array, p: Parameters, frame: Frame, structure: Structure
): Promise<{
  hypotheses: Array<{ arithmetic: string; output: ReturnType<typeof comparePresent>; stages: ReturnType<typeof traceChecks> }>;
  replay: ReturnType<typeof comparePresent>; stages: ReturnType<typeof traceChecks>;
  target: { point: number; axis: string; stages: Array<{ stage: string; actual: number; expected: number; error: number }> } | null;
}> {
  if (!backend.diagnose) throw new Error('Backend does not support stage tracing')
  const expectedTrace = createTrace(points.length / 4)
  const expected = gridReference(input, points, p, frame, structure, expectedTrace)
  const actual = await backend.diagnose()
  const replay = comparePresent({ ...normal, forces: actual.forces }, normal, points)
  const a: Trace = { ...actual.trace, final: normal.forces, positions: normal.positions }
  const b: Trace = { ...expectedTrace, final: expected.forces, positions: expected.positions }
  const stages = traceChecks(a, b, points)
  const worst = stages.find(s => s.stage === 'final')?.worst
  return {
    replay,
    stages,
    hypotheses: (['reciprocal', 'fused-reciprocal', 'fused-reciprocal-rsqrt'] as const).map(arithmetic => {
      const trace = createTrace(points.length / 4)
      const alternative = gridReference(input, points, p, frame, structure, trace, arithmetic)
      return { arithmetic, output: comparePresent(normal, alternative, points), stages: traceChecks(actual.trace, trace, points) }
    }),
    target: worst
      ? {
        point: worst.point,
        axis: worst.axis,
        stages: Object.keys(b).map(stage => {
          const i = worst.point * 4 + (worst.axis === 'x' ? 0 : 1)
          return { stage, actual: a[stage][i], expected: b[stage][i], error: Math.abs(a[stage][i] - b[stage][i]) }
        }),
      }
      : null,
  }
}
