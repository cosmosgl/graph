import type { ReductionCenter } from '../scalable-reduction/backend'
import { createScalableReductionBackend } from '../scalable-reduction/backend'
import type { SimulationBenchmarkBackend } from './backend'

export async function createWebGPUSimulationBenchmark (
  canvas: HTMLCanvasElement,
  pointCount: number
): Promise<SimulationBenchmarkBackend> {
  const backend = await createScalableReductionBackend(canvas, pointCount)
  await backend.run(false, false)
  return {
    benchmark: iterations => backend.benchmark(iterations),
    async readCenter (): Promise<ReductionCenter> {
      const result = await backend.run(false, true)
      if (!result.center) throw new Error('WebGPU center readback was unavailable')
      return result.center
    },
    destroy: () => backend.destroy(),
  }
}
