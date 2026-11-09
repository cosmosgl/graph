import type { Device } from '@luma.gl/core'
import { createNeighborhoodBackend, type Timing } from './backend'
import { createPositions, DEFAULT_PARAMETERS, type Validation } from './reference'

export const COMPARISON_SEED = 20261109
const scenarios = [
  { scenario: 'dense', count: 65536, density: 16, radius: 0.16 },
  { scenario: 'sparse', count: 65536, density: 1, radius: 0.04 },
  { scenario: 'small', count: 4096, density: 4, radius: 0.08 },
] as const

type PrecisionConfiguration = typeof scenarios[number] & { gridSize: number; repetition: number }

export function createPrecisionPlan (): PrecisionConfiguration[] {
  const plan = scenarios.flatMap(scenario => [16, 32, 64].flatMap(gridSize =>
    Array.from({ length: 4 }, (_, repetition) => ({ ...scenario, gridSize, repetition }))))
  let state = COMPARISON_SEED
  for (let i = plan.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const j = state % (i + 1)
    ;[plan[i], plan[j]] = [plan[j], plan[i]]
  }
  return plan
}
export type PrecisionRow = ReturnType<typeof createPrecisionPlan>[number] & {
  accumulation: 'blocked' | 'chunked';
  validation: Validation;
  evolvedValidation?: Validation;
  timings: Timing[] | null;
}

export async function runPrecisionComparison (
  device: Device,
  cancelled: () => boolean,
  onProgress: (message: string) => void,
  rows: PrecisionRow[]
): Promise<void> {
  const plan = createPrecisionPlan()
  for (const item of plan) {
    const order = item.repetition % 2 ? ['chunked', 'blocked'] as const : ['blocked', 'chunked'] as const
    for (const accumulation of order) {
      if (cancelled()) return
      onProgress(`Precision cost ${rows.length + 1}/${plan.length * 2}: ${item.scenario}, grid ${item.gridSize}, ${accumulation}…`)
      await new Promise<void>(resolve => window.setTimeout(resolve, 0))
      const canvas = document.createElement('canvas')
      canvas.width = 480; canvas.height = 480
      const backend = await createNeighborhoodBackend(device, createPositions(item.count, 'uniform', item.density),
        { ...DEFAULT_PARAMETERS, radius: item.radius }, item.gridSize, 'grid', canvas, accumulation)
      try {
        const validation = await backend.validate(false, 1024)
        let evolvedValidation: Validation | undefined
        if (item.repetition === 0 && validation.valid) {
          for (let i = 0; i < 3; i += 1) await backend.step()
          evolvedValidation = await backend.validate(false, 1024)
        }
        const timings = validation.valid && evolvedValidation?.valid !== false && !cancelled()
          ? await backend.benchmark(cancelled, undefined, ['force', 'tick'])
          : null
        rows.push({ ...item, accumulation, validation, evolvedValidation, timings })
      } finally { backend.destroy() }
    }
  }
}
