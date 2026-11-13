import { fitView } from '../many-body/backend'
import { compareArray, type Snapshot } from '../many-body/reference'
import type { Measurement } from '../many-body/timing'
import { frameFor } from '../many-body-grid/data'
import { cool, STAGES, type Settings } from './data'
import { createOracle } from './reference'
import { differingBits } from './resident'
import { createCapacityLane, type CapacityLane, type ResizeReport } from './capacity'
export type CapacityComparison = 'transfer' | 'reuse'
export type ResizeCheck = {
  tick: number; alpha: number; reports: ResizeReport[]; differing: number[]; valid: boolean; order: number[];
}
export type CapacityCheckpoint = {
  tick: number; count: number; positions: number; forces: number; cpu?: ReturnType<typeof compareArray>;
  timing: Measurement; controlTiming?: Measurement; valid: boolean; order: number[];
}
export async function createCapacitySession (
  settings: Settings, canvas: (lane: number) => HTMLCanvasElement, comparison: CapacityComparison = 'transfer'
): Promise<{
  comparison: CapacityComparison;
  lanes: CapacityLane[]; resizes: ResizeCheck[]; rows: CapacityCheckpoint[];
  edits: Array<{ tick: number; index: number; point?: number[]; absent?: boolean }>;
  tick(): number; alpha(): number; resize(count: number, preserve?: boolean): Promise<ResizeCheck>;
  step(checkCpu?: boolean): Promise<CapacityCheckpoint>; patch(index: number, point: Float32Array): void;
  absent(index: number, value: boolean): void; render(): void; destroy(): void;
}> {
  const lanes: CapacityLane[] = []; const resizes: ResizeCheck[] = []; const rows: CapacityCheckpoint[] = []
  const edits: Array<{ tick: number; index: number; point?: number[]; absent?: boolean }> = []
  const resizeVisits = new Map<string, number>(); const frameVisits = new Map<number, number>()
  let tick = 0; let alpha = 1; let busy = false; let destroyed = false; let failed = false
  const healthy = (): void => { if (destroyed || busy || failed) throw new Error('Capacity session unavailable') }
  const dispose = (): void => { if (destroyed) return; destroyed = true; lanes.forEach(l => l.destroy()) }
  const view = fitView([new Float32Array([-128, -128, 0, 0, 128, 128, 0, 0])])
  try {
    lanes.push(await createCapacityLane(canvas(0), settings, comparison === 'reuse' ? 'gpu' : 'cpu'))
    lanes.push(await createCapacityLane(canvas(1), settings, 'gpu', comparison === 'reuse' ? 'retain' : 'rebuild'))
    return {
      comparison,
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
          const key = `${lanes[0].count}:${count}:${preserve}`; const visit = resizeVisits.get(key) ?? 0
          resizeVisits.set(key, visit + 1)
          const order = comparison === 'reuse' && visit % 2 ? [1, 0] : [0, 1]
          for (const i of order) reports[i] = await lanes[i].resize(count, preserve)
          const actual = await Promise.all(lanes.map(l => l.backend.read()))
          const differing = actual.map((s, i) => {
            const expected = lanes[i].data.input.points.slice()
            if (preserve) expected.set(previous[i].positions.subarray(0, Math.min(count, reports[i].from) * 4))
            return differingBits(s.positions, expected)
          })
          const valid = reports.every(r => r.deviceRetained) && differing.every(n => n === 0) &&
            differingBits(actual[0].positions, actual[1].positions) === 0
          const row = { tick, alpha, reports, differing, valid, order }; resizes.push(row); failed = !valid; return row
        } catch (error) { failed = true; throw error } finally { busy = false }
      },
      async step (checkCpu = false): Promise<CapacityCheckpoint> {
        healthy(); busy = true
        try {
          const before = checkCpu ? (await lanes[0].backend.read()).positions : undefined
          const cpu = before ? createOracle(lanes[0].data.graph, lanes[0].data.input).tick(before, alpha, tick) : undefined
          const control = lanes[0].backend
          const reference = async (): Promise<{ snapshot: Snapshot; timing?: Measurement }> => {
            if (comparison === 'reuse') return control.measureCurrentFrame!(alpha, tick, view)
            for (const stage of STAGES) {
              if (stage === 'repulsion') control.setFrame(frameFor((await control.read()).positions, tick))
              control.stepStage(stage, alpha)
            }
            return { snapshot: await control.read() }
          }
          const candidate = (): ReturnType<NonNullable<typeof control.measureCurrentFrame>> =>
            lanes[1].backend.measureCurrentFrame!(alpha, tick, view)
          // Balance each COUNT, not tick parity: the resize cycle reaches 8192
          // only at odd ticks, so alternating ticks leaves that count biased.
          const visit = frameVisits.get(lanes[0].count) ?? 0
          frameVisits.set(lanes[0].count, visit + 1)
          const order = comparison === 'reuse' && visit % 2 ? [0, 1] : [1, 0]
          let measured; let baseline
          if (order[0] === 0) {
            baseline = await reference(); measured = await candidate()
          } else { measured = await candidate(); baseline = await reference() }
          const snapshot = baseline.snapshot
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
            controlTiming: baseline.timing,
            order,
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
