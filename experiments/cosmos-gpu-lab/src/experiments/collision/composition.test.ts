import { expect, it } from 'vitest'
import { compareArray } from '../many-body/reference'
import { createOracle } from '../combined-layout/reference'
import { createFixture, COLLISION } from './data'
import { createBackend, parametersFor, sequence } from './backend'
import { evaluate, expectedTick } from './checks'
for (const arithmetic of ['native', 'strict'] as const) {
  it.skipIf(!import.meta.env.LAB_NATIVE_GPU)(`dense four-pass / ${arithmetic}: retain center residuals on the GPU`, async () => {
    const settings = {
      fixture: 'clusters' as const,
      count: 512,
      mode: 'combined' as const,
      alpha: 1,
      arithmetic,
      collision: { ...COLLISION, iterations: 4 },
    }
    const { input, graph } = createFixture(settings.fixture, settings.count); const parameters = parametersFor(settings)
    parameters.centerReduction = 'f32'
    const oracle = createOracle(graph, input, 'production', parameters); const stages = sequence(settings.mode, parameters)
    const start = expectedTick(oracle, stages, input.points, 1).positions
    const b = await createBackend('webgpu', document.createElement('canvas'), graph, input, parameters)
    try {
      const original = await evaluate(b, oracle, stages, start, 1)
      b.setPositions(start); let previous = start; let centerError = 0
      for (const stage of stages) {
        const expected = oracle.stage(stage, previous, 1, 0)
        b.stepStage(stage, 1); const actual = await b.read()
        if (stage === 'center') {
          centerError = compareArray(actual.positions, expected.positions).maxError
          // Diagnostic only: replace exactly this intermediate, keeping all
          // other GPU stages and the same physical force settings.
          b.setPositions(expected.positions); previous = expected.positions
        } else previous = actual.positions
      }
      const corrected = compareArray(previous, expectedTick(oracle, stages, start, 1).positions)
      expect(corrected.valid, JSON.stringify({ arithmetic, original: original.gate.whole, centerError, corrected })).toBe(true)
      // The actual fix must pass without uploading a CPU intermediate. Both
      // reductions were allocated before dispatch; only the GPU path changes.
      parameters.centerReduction = 'high-low'
      const resident = await evaluate(b, oracle, stages, start, 1)
      expect(resident.gate.valid, JSON.stringify(resident.gate)).toBe(true)
      expect(resident.gate.stages.find(s => s.stage === 'center')!.positions.maxError).toBe(0)
      expect(resident.gate.stages.find(s => s.stage === 'center')!.aggregate!.maxError).toBe(0)
      expect(resident.gate.stages.find(s => s.stage === 'center')!.forces.maxError).toBe(0)
    } finally { b.destroy() }
  }, 120000)
}
