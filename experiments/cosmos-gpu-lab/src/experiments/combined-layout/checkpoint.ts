import { compareArray, type Snapshot } from '../many-body/reference'
import { compareArray as springCompare } from '../weighted-links/reference'
import type { CombinedBackend } from './backend'
import { STAGES } from './data'
import type { createOracle } from './reference'
import { profileCheck } from './controlled-profile'
import { differingBits } from './resident'
export type CheckpointResult = {
  stages: Array<{ stage: string; positions: number; forces: number; cpuValid: boolean }>;
  normal: ReturnType<typeof profileCheck>[]; valid: boolean;
  failure?: { stage: string; input: Float32Array; actual: Snapshot; expected: Snapshot };
}
// Replay only GPU-derived checkpoint inputs. Restore each lane's ordinary
// output afterwards; no CPU reference position ever enters the trajectory.
export async function validateCheckpoint (
  backends: CombinedBackend[], oracle: ReturnType<typeof createOracle>, start: Float32Array, alpha: number, tick: number, normal: Snapshot[]
): Promise<CheckpointResult> {
  const result: CheckpointResult = { stages: [], normal: [], valid: false }
  try {
    const whole = oracle.tick(start, alpha, tick)
    for (const b of backends) { b.setPositions(start); b.setGpuFrame!(tick) }
    let current = start; let snapshots: Snapshot[] = []
    for (const stage of STAGES) {
      const expected = oracle.stage(stage, current, alpha, tick)
      for (const b of backends) b.stepStage(stage, alpha)
      snapshots = await Promise.all(backends.map(b => b.read()))
      const compare = stage === 'incoming' || stage === 'outgoing' ? springCompare : compareArray
      const checks = snapshots.map(s => ({ positions: compare(s.positions, expected.positions), forces: compare(s.forces, expected.forces) }))
      const positions = differingBits(snapshots[0].positions, snapshots[1].positions)
      const forces = differingBits(snapshots[0].forces, snapshots[1].forces)
      const cpuValid = checks.every(c => c.positions.valid && c.forces.valid)
      result.stages.push({ stage, positions, forces, cpuValid })
      if (positions || forces || !cpuValid) {
        const cpuLane = checks.findIndex(c => !c.positions.valid || !c.forces.valid)
        result.failure = { stage, input: current, actual: snapshots[cpuLane < 0 ? 1 : cpuLane], expected: cpuLane < 0 ? snapshots[0] : expected }
        return result
      }
      current = snapshots[0].positions
    }
    result.normal = normal.map((s, lane) => profileCheck(s, snapshots[lane], whole))
    result.valid = result.normal.every(c => c.valid)
    if (!result.valid) {
      const lane = result.normal.findIndex(c => !c.valid)
      const cpuFailed = !result.normal[lane].cpu.valid
      result.failure = {
        stage: cpuFailed ? 'whole-tick CPU' : 'normal frame replay',
        input: start,
        actual: normal[lane],
        expected: cpuFailed ? { positions: whole, forces: snapshots[lane].forces } : snapshots[lane],
      }
    }
    return result
  } finally { backends.forEach((b, lane) => b.setPositions(normal[lane].positions)) }
}
