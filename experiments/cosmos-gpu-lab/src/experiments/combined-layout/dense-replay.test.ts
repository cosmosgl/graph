import { expect, it } from 'vitest'
import { createFixture } from '../many-body/data'
import { compareArray } from '../many-body/reference'
import { createTrace } from '../many-body-grid/trace'
import { frameFor, buildReference } from '../many-body-grid/data'
import { gridReference } from '../many-body-grid/reference'
import { createGraph, REPULSION, STAGES } from './data'
import { createOracle } from './reference'
import { createCombinedWebGPU } from './webgpu'
import { differingBits } from './resident'

for (const count of [4096, 8192]) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`${count}: dense community tick follows independent CPU states`, async () => {
    const { graph, input } = createGraph({ count, fixture: 'communities', decay: 100, springPrecision: 'trig' })
    input.points = createFixture('clusters', count).points; graph.points = input.points
    input.points[2] = 1; input.points[7] = 1
    const oracle = createOracle(graph, input)
    const backend = await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'trig', { gpuBounds: true })
    let cpu = input.points
    try {
      backend.setGpuFrame!(0)
      for (const stage of STAGES) {
        const expected = oracle.stage(stage, cpu, 1, 0)
        backend.stepStage(stage, 1); const actual = await backend.read()
        if (stage === 'repulsion') {
          const expectedTrace = createTrace(count); const frame = frameFor(cpu, 0)
          gridReference(input, cpu, REPULSION, frame, buildReference(cpu, frame), expectedTrace)
          const diagnosis = await backend.diagnose!()
          // Tracing uses at most the portable eight storage bindings, even with
          // resident bounds, and cannot alter the normal force/position buffers.
          expect(differingBits(diagnosis.forces, actual.forces)).toBe(0)
          expect(differingBits((await backend.read()).positions, actual.positions)).toBe(0)
          for (const [name, values] of Object.entries(expectedTrace)) {
            expect(differingBits(diagnosis.trace[name], values), name).toBe(0)
          }
        }
        const check = compareArray(actual.positions, expected.positions)
        expect(check.valid, JSON.stringify({ stage, check })).toBe(true)
        cpu = expected.positions
      }
    } finally { backend.destroy() }
  })
}
