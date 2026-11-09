import { createDevice, waitForGpu } from '../../gpu/luma'
import { createBlendReduction } from '../center-mass/webgl/reduction'
import type { ReductionBenchmark, ReductionCenter } from '../scalable-reduction/backend'
import { createInitialPositions } from '../scalable-reduction/reference'
import type { SimulationBenchmarkBackend } from './backend'

export async function createWebGLSimulationBenchmark (canvas: HTMLCanvasElement, pointCount: number): Promise<SimulationBenchmarkBackend> {
  const device = await createDevice('webgl', canvas)
  try {
    const reduction = createBlendReduction(device, pointCount)
    reduction.positions.write(createInitialPositions(pointCount))
    return {
      async benchmark (iterations: number): Promise<ReductionBenchmark> {
        const start = performance.now(); reduction.encode(iterations); device.submit(); const submitted = performance.now()
        await waitForGpu(device)
        const totalMilliseconds = performance.now() - start
        return { iterations, submitMilliseconds: submitted - start, totalMilliseconds, averageMilliseconds: totalMilliseconds / iterations }
      },
      async readCenter (): Promise<ReductionCenter> {
        reduction.encode(); device.submit()
        const values = reduction.read()
        return { x: values[0] / values[2], y: values[1] / values[2], count: values[2] }
      },
      destroy (): void { reduction.destroy(); device.destroy() },
    }
  } catch (error) { device.destroy(); throw error }
}
