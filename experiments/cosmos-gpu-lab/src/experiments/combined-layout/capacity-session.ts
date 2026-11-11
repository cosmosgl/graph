import { fitView } from '../many-body/backend'
import { compareArray, type Snapshot } from '../many-body/reference'
import type { Measurement } from '../many-body/timing'
import { frameFor } from '../many-body-grid/data'
import { cool, STAGES, type Settings } from './data'
import { createOracle } from './reference'
import { differingBits } from './resident'
import { createCapacityLane, type CapacityLane, type ResizeReport } from './capacity'
export type ResizeCheck = {
  tick: number; alpha: number; reports: ResizeReport[]; differing: number[]; valid: boolean;
}
export type CapacityCheckpoint = {
  tick: number; count: number; positions: number; forces: number; cpu?: ReturnType<typeof compareArray>;
  timing: Measurement; valid: boolean;
}
export async function createCapacitySession (settings: Settings, canvas: (lane: number) => HTMLCanvasElement): Promise<{
  lanes: CapacityLane[]; resizes: ResizeCheck[]; rows: CapacityCheckpoint[];
  edits: Array<{ tick: number; index: number; point?: number[]; absent?: boolean }>;
  tick(): number; alpha(): number; resize(count: number, preserve?: boolean): Promise<ResizeCheck>;
  step(checkCpu?: boolean): Promise<CapacityCheckpoint>; patch(index: number, point: Float32Array): void;
  absent(index: number, value: boolean): void; render(): void; destroy(): void;
}> {
  const lanes: CapacityLane[] = []; const resizes: ResizeCheck[] = []; const rows: CapacityCheckpoint[] = []
  const edits: Array<{ tick: number; index: number; point?: number[]; absent?: boolean }> = []
  let tick = 0; let alpha = 1; let busy = false; let destroyed = false; let failed = false
  const healthy = (): void => { if (destroyed || busy || failed) throw new Error('Capacity session unavailable') }
  const dispose = (): void => { if (destroyed) return; destroyed = true; lanes.forEach(l => l.destroy()) }
  const view = fitView([new Float32Array([-128, -128, 0, 0, 128, 128, 0, 0])])
  try {
    lanes.push(await createCapacityLane(canvas(0), settings, 'cpu'))
    lanes.push(await createCapacityLane(canvas(1), settings, 'gpu'))
    return {
      lanes,
      resizes,
      rows,
      edits,
      tick: () => tick,
      alpha: () => alpha,
      async resize (count, preserve = true): Promise<ResizeCheck> {
        healthy()
        if (!Number.isInteger(count) || count < 4 || count > 16384) throw new Error('Capacity experiment supports 4–16384 points')
        busy = true
        try {
          // Validation snapshots are outside the measured update. The resident
          // lane's resize implementation itself never reads positions to the CPU.
          const previous = await Promise.all(lanes.map(l => l.backend.read()))
          const reports: ResizeReport[] = []
          for (const lane of lanes) reports.push(await lane.resize(count, preserve))
          const actual = await Promise.all(lanes.map(l => l.backend.read()))
          const differing = actual.map((s, i) => {
            const expected = lanes[i].data.input.points.slice()
            if (preserve) expected.set(previous[i].positions.subarray(0, Math.min(count, reports[i].from) * 4))
            return differingBits(s.positions, expected)
          })
          const valid = reports.every(r => r.deviceRetained) && differing.every(n => n === 0) &&
            differingBits(actual[0].positions, actual[1].positions) === 0
          const row = { tick, alpha, reports, differing, valid }; resizes.push(row); failed = !valid; return row
        } catch (error) { failed = true; throw error } finally { busy = false }
      },
      async step (checkCpu = false): Promise<CapacityCheckpoint> {
        healthy(); busy = true
        try {
          const before = checkCpu ? (await lanes[0].backend.read()).positions : undefined
          const cpu = before ? createOracle(lanes[0].data.graph, lanes[0].data.input).tick(before, alpha, tick) : undefined
          const measured = await lanes[1].backend.measureCurrentFrame!(alpha, tick, view)
          const control = lanes[0].backend
          for (const stage of STAGES) {
            if (stage === 'repulsion') control.setFrame(frameFor((await control.read()).positions, tick))
            control.stepStage(stage, alpha)
          }
          const snapshot: Snapshot = await control.read()
          const positions = differingBits(measured.snapshot.positions, snapshot.positions)
          const forces = differingBits(measured.snapshot.forces, snapshot.forces)
          const check = cpu ? compareArray(measured.snapshot.positions, cpu) : undefined
          const finite = measured.snapshot.positions.every(Number.isFinite) && measured.snapshot.forces.every(Number.isFinite)
          tick++; alpha = cool(alpha, settings.decay)
          const row = {
            tick,
            count: lanes[0].count,
            positions,
            forces,
            cpu: check,
            timing: measured.timing,
            valid: finite && positions === 0 && forces === 0 && (!check || check.valid),
          }
          rows.push(row); failed = !row.valid; return row
        } catch (error) { failed = true; throw error } finally { busy = false }
      },
      patch (index, point): void {
        healthy(); lanes.forEach(l => l.patch(index, point)); edits.push({ tick, index, point: Array.from(point) })
      },
      absent (index, value): void {
        healthy(); lanes.forEach(l => l.backend.setAbsent!(index, value)); edits.push({ tick, index, absent: value })
      },
      render (): void { if (!destroyed) lanes.forEach(l => l.backend.render(view)) },
      destroy: dispose,
    }
  } catch (error) { dispose(); throw error }
}
export type CapacitySession = Awaited<ReturnType<typeof createCapacitySession>>
