import { fitView } from '../many-body/backend'
import { frameFor } from '../many-body-grid/data'
import { cool, createGraph, STAGES, type Settings } from './data'
import { createCombinedWebGPU } from './webgpu'
import type { CombinedBackend } from './backend'

export type ResidentCheck = {
  tick: number; bounds: number; positions: number; forces: number; aggregates: number; slots: number; centroids: number; finite: boolean; valid: boolean;
}
export type Readbacks = { snapshots: number; bytes: number }
export function differingBits (a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('Cannot compare different buffer lengths')
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length); const y = new Uint32Array(b.buffer, b.byteOffset, b.length)
  let count = 0
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) count++
  return count
}

// The resident lane has no CPU oracle, position upload, bounds readback or wait
// inside an unchecked tick. The staged lane intentionally retains those waits.
// Checkpoints compare scheduling/dataflow, not an independent force reference.
export async function createResidentComparison (
  settings: Settings, canvas: (resident: boolean) => HTMLCanvasElement
): Promise<{
  info: string[]; rows: ResidentCheck[]; readbacks: Readbacks[]; tick(): number; alpha(): number;
  step(): Promise<ResidentCheck | undefined>; render(): void; destroy(): void;
}> {
  const { graph, input } = createGraph(settings)
  const backends: CombinedBackend[] = []; const rows: ResidentCheck[] = []
  const readbacks: Readbacks[] = [{ snapshots: 0, bytes: 0 }, { snapshots: 0, bytes: 0 }]
  let tick = 0; let alpha = 1; let destroyed = false; let busy = false; let failed = false
  const view = fitView([input.points]); view[2] /= 2; view[3] /= 2
  const dispose = (): void => { if (destroyed) return; destroyed = true; backends.forEach(b => b.destroy()) }
  try {
    for (const resident of [false, true]) {
      backends.push(await createCombinedWebGPU(canvas(resident), graph, input, settings.springPrecision, { gpuBounds: resident }))
    }
    const read = async (lane: number): ReturnType<CombinedBackend['read']> => {
      const snapshot = await backends[lane].read()
      readbacks[lane].snapshots++; readbacks[lane].bytes += snapshot.positions.byteLength + snapshot.forces.byteLength
      return snapshot
    }
    return {
      info: backends.map(b => b.info),
      rows,
      readbacks,
      tick: () => tick,
      alpha: () => alpha,
      async step (): Promise<ResidentCheck | undefined> {
        if (busy || destroyed || failed || tick >= settings.decay) throw new Error('Resident comparison unavailable')
        busy = true
        try {
          // Encode the resident tick BEFORE waiting for the diagnostic lane.
          backends[1].stepTick!(alpha, tick)
          for (const stage of STAGES) {
            if (stage === 'repulsion') {
              const gravity = await read(0)
              backends[0].setFrame(frameFor(gravity.positions, tick))
            }
            backends[0].stepStage(stage, alpha)
          }
          tick++; alpha = cool(alpha, settings.decay)
          const checked = tick === 1 || tick === settings.decay || tick % (settings.checkpointEvery ?? 10) === 0
          if (!checked) return undefined
          const snapshots = await Promise.all([read(0), read(1)])
          const bounds = await Promise.all(backends.map(b => b.readBounds!()))
          const structures = await Promise.all(backends.map(b => b.readStructure()))
          const centroids = await Promise.all(backends.map(b => b.readCentroids!()))
          const differences = {
            bounds: differingBits(bounds[0], bounds[1]),
            positions: differingBits(snapshots[0].positions, snapshots[1].positions),
            forces: differingBits(snapshots[0].forces, snapshots[1].forces),
            aggregates: differingBits(structures[0].aggregates, structures[1].aggregates),
            slots: differingBits(structures[0].slots, structures[1].slots),
            centroids: differingBits(centroids[0], centroids[1]),
          }
          const finite = snapshots.every(s => {
            for (let i = 0; i < s.positions.length; i += 4) {
              if (s.positions[i + 3] <= 0.5 && (!Number.isFinite(s.positions[i]) || !Number.isFinite(s.positions[i + 1]))) return false
            }
            return s.forces.every(Number.isFinite)
          })
          const row = { tick, ...differences, finite, valid: finite && Object.values(differences).every(n => n === 0) }
          failed = !row.valid
          rows.push(row); return row
        } catch (error) {
          failed = true; throw error
        } finally { busy = false }
      },
      render (): void { if (!destroyed) backends.forEach(b => b.render(view)) },
      destroy: dispose,
    }
  } catch (error) { dispose(); throw error }
}
export type ResidentComparison = Awaited<ReturnType<typeof createResidentComparison>>
