import type { Device } from '@luma.gl/core'
import { createCpuGridReference } from '../spatial-grid/reference'
import { createNeighborhoodBackend, type Method, type Timing } from './backend'
import { BRUTE_LIMIT, createPositions, DEFAULT_PARAMETERS, type Validation } from './reference'

export type SweepPreset = 'quick' | 'standard' | 'large'
export type SweepCase = { count: number; density: number; radius: number; gridSize: number; repetition: number }
export type SweepRow = SweepCase & {
  method: Method;
  status: 'passed' | 'failed' | 'skipped' | 'cancelled';
  reason?: string;
  cellWidth: number;
  nominalDensity: number;
  occupiedCells?: number;
  maximumCellLoad?: number;
  validation?: Validation;
  timings?: Timing[];
}

export const SWEEP_AXES = {
  quick: { counts: [256, 1024], densities: [1, 4], radii: [0.04, 0.08], grids: [16, 64] },
  standard: { counts: [1024, 4096, 16384], densities: [1, 4, 16], radii: [0.04, 0.08, 0.16], grids: [16, 32, 64] },
  large: { counts: [1024, 4096, 16384, 65536], densities: [1, 4, 16], radii: [0.04, 0.08, 0.16], grids: [16, 32, 64] },
} as const

export function createSweepPlan (preset: SweepPreset, repeats: number, seed: number): SweepCase[] {
  if (![1, 2, 3].includes(repeats) || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('Use 1–3 repetitions and an integer seed from 0 to 4294967295')
  }
  const axes = SWEEP_AXES[preset]
  const plan: SweepCase[] = []
  for (let repetition = 0; repetition < repeats; repetition += 1) {
    for (const count of axes.counts) {
      for (const density of axes.densities) {
        for (const radius of axes.radii) {
          for (const gridSize of axes.grids) {
            plan.push({ count, density, radius, gridSize, repetition })
          }
        }
      }
    }
  }
  // Seeded Fisher–Yates; unsigned LCG also supports seed zero.
  let random = seed >>> 0
  for (let i = plan.length - 1; i > 0; i -= 1) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    const j = Math.floor(random / 0x100000000 * (i + 1))
    ;[plan[i], plan[j]] = [plan[j], plan[i]]
  }
  return plan
}

export function methodOrder (entry: SweepCase): Method[] {
  // Each configuration reverses order on its next repetition.
  const parity = [256, 1024, 4096, 16384, 65536].indexOf(entry.count) +
    [1, 4, 16].indexOf(entry.density) + [16, 32, 64].indexOf(entry.gridSize) +
    [0.04, 0.08, 0.16].indexOf(entry.radius) + entry.repetition
  return parity % 2 === 0 ? ['brute', 'grid'] : ['grid', 'brute']
}

export async function runSweep (
  device: Device,
  plan: SweepCase[],
  cancelled: () => boolean,
  onRow: (row: SweepRow, completed: number, total: number) => void
): Promise<SweepRow[]> {
  const rows: SweepRow[] = []
  let lost = false
  device.lost.then(() => { lost = true })
  for (const entry of plan) {
    if (cancelled() || lost) break
    const initial = createPositions(entry.count, 'uniform', entry.density)
    const occupancy = createCpuGridReference(initial, entry.gridSize)
    for (const method of methodOrder(entry)) {
      if (cancelled() || lost) break
      const row: SweepRow = {
        ...entry,
        method,
        status: 'passed',
        cellWidth: 2 / entry.gridSize,
        nominalDensity: entry.count * entry.density / 4,
        occupiedCells: occupancy.occupiedCells,
        maximumCellLoad: occupancy.maximumCellLoad,
      }
      let backend: Awaited<ReturnType<typeof createNeighborhoodBackend>> | undefined
      try {
        if (method === 'brute' && entry.count > BRUTE_LIMIT) {
          row.status = 'skipped'
          row.reason = 'All-pairs limit: 4,096 points'
        } else {
          const canvas = document.createElement('canvas')
          canvas.width = 480
          canvas.height = 480
          backend = await createNeighborhoodBackend(device, initial,
            { ...DEFAULT_PARAMETERS, radius: entry.radius }, entry.gridSize, method, canvas)
          if (cancelled() || lost) throw new Error('Sweep cancelled')
          row.validation = await backend.validate()
          if (!row.validation.valid) throw new Error('CPU validation failed; timing skipped')
          row.timings = await backend.benchmark(() => cancelled() || lost)
          if (cancelled() || lost) throw new Error('Sweep cancelled')
        }
      } catch (error) {
        row.status = cancelled() || lost ? 'cancelled' : 'failed'
        row.reason = error instanceof Error ? error.message : String(error)
      } finally { backend?.destroy() }
      rows.push(row)
      onRow(row, rows.length, plan.length * 2)
      // Return control between rows so cancel and progress remain responsive.
      await new Promise<void>(resolve => window.setTimeout(resolve, 0))
    }
  }
  return rows
}
