import { compareArray, type Snapshot } from '../many-body/reference'
import { compareArray as springCompare } from '../weighted-links/reference'
import { centerAggregate } from '../combined-layout/center-reference'
import { createOracle } from '../combined-layout/reference'
import type { CombinedBackend } from '../combined-layout/backend'
import type { Stage } from '../combined-layout/data'
export type Check = { stage: Stage; forces: ReturnType<typeof springCompare>; positions: ReturnType<typeof springCompare>;
  absentSpringTargets: number;
  flagsExact: boolean; aggregate?: ReturnType<typeof compareArray>; valid: boolean; }
export type Gate = { stages: Check[]; whole: ReturnType<typeof compareArray>; valid: boolean }
export type Failure = { input: Float32Array; actual: Snapshot; expected: Snapshot; check: Check; stage: Stage }
export function stageCheck (stage: Stage, actual: Snapshot, expected: Snapshot, input: Float32Array): Check {
  const spring = stage === 'incoming' || stage === 'outgoing'; const compare = spring ? springCompare : compareArray
  // The pre-existing spring budget remains unchanged. Only explicitly absent
  // NaN coordinates may preserve their sentinel rather than a numeric value.
  const a = actual.positions.slice(); const e = expected.positions.slice()
  const actualForces = actual.forces.slice(); const expectedForces = expected.forces.slice(); let absentSpringTargets = 0
  if (spring) {
    for (let i = 0; i < input.length; i += 4) {
      if (input[i + 3] > 0.5) {
        absentSpringTargets++
        for (let c = 0; c < 2; c++) {
          // Spring corrections for absent targets are not consumed and may be
          // NaN. Collision defines zero and never takes this exclusion.
          actualForces[i + c] = expectedForces[i + c] = 0
          if (Number.isNaN(a[i + c]) && Number.isNaN(e[i + c])) a[i + c] = e[i + c] = 0
        }
      }
    }
  }
  const forces = compare(actualForces, expectedForces)
  const positions = spring ? compare(a, e) : compareArray(a, e, input)
  const flagsExact = actual.positions.every((v, i) => i % 4 < 2 || v === expected.positions[i]) &&
    actual.forces.every((v, i) => i % 4 < 2 || v === expected.forces[i])
  return { stage, forces, positions, flagsExact, absentSpringTargets, valid: forces.valid && positions.valid && flagsExact }
}
export function sameBits (a: Float32Array, b: Float32Array): boolean {
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length); const y = new Uint32Array(b.buffer, b.byteOffset, b.length)
  return x.length === y.length && x.every((v, i) => v === y[i])
}
export function expectedTick (oracle: ReturnType<typeof createOracle>, stages: readonly Stage[], start: Float32Array, alpha: number): Snapshot {
  let result: Snapshot = { positions: start, forces: new Float32Array(start.length) }
  for (const stage of stages) result = oracle.stage(stage, result.positions, alpha, 0)
  return result
}
export async function evaluate (
  backend: CombinedBackend, oracle: ReturnType<typeof createOracle>, stages: readonly Stage[], start: Float32Array, alpha: number
): Promise<{ gate: Gate; actual: Snapshot; expected: Snapshot; failure?: Failure }> {
  backend.setPositions(start); let previous = start; const checks: Check[] = []; let failure: Failure | undefined
  let actual: Snapshot = { positions: start, forces: new Float32Array(start.length) }
  for (const stage of stages) {
    const expected = oracle.stage(stage, previous, alpha, 0)
    backend.stepStage(stage, alpha); actual = await backend.read()
    const check = stageCheck(stage, actual, expected, previous)
    if (stage === 'center') {
      check.aggregate = compareArray(await backend.readCenter!(), centerAggregate(previous)); check.valid &&= check.aggregate.valid
    }
    checks.push(check)
    if (!check.valid && !failure) failure = { input: previous.slice(), actual, expected, check, stage }
    previous = actual.positions
  }
  const expected = expectedTick(oracle, stages, start, alpha); const whole = compareArray(actual.positions, expected.positions, start)
  return { gate: { stages: checks, whole, valid: whole.valid && checks.every(c => c.valid) }, actual, expected, failure }
}
