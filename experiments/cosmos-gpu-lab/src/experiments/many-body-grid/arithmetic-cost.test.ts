import { expect, it, vi } from 'vitest'
import { createFixture, PARAMETERS } from '../many-body/data'
import { chooseOperations, summarize, TIMING_POLICY, type Measurement } from '../many-body/timing'
import { frameFor, buildReference } from './data'
import { comparePresent, gridReference } from './reference'
import type { GridBackend } from './backend'
import { createGridWebGPU } from './webgpu'
import { materializedFarShader, streamedFarShader } from './far-shader'
import { replaceOnce } from './trace'

// Mock the shader builders, not a cached raw import: both backends must compile
// genuinely different arithmetic. No historical control enters the shipped app.
vi.mock('./far-shader', async importOriginal => {
  const actual = await importOriginal<typeof import('./far-shader')>()
  return {
    ...actual,
    materializedFarShader: vi.fn(actual.materializedFarShader),
    streamedFarShader: vi.fn(actual.streamedFarShader),
  }
})

for (const count of [8192, 16384]) {
  for (const mode of ['materialized', 'streamed'] as const) {
    it.runIf(import.meta.env.LAB_FAR_ARITHMETIC_COST)(`${count}/${mode}: compares residual and integer rounding with paired GPU batches`, async () => {
      const actualBuilders = await vi.importActual<typeof import('./far-shader')>('./far-shader')
      const builder = mode === 'materialized' ? materializedFarShader : streamedFarShader
      const original = mode === 'materialized' ? actualBuilders.materializedFarShader : actualBuilders.streamedFarShader
      const input = createFixture('clusters', count); const frame = frameFor(input.points, 0)
      const expected = gridReference(input, input.points, PARAMETERS, frame, buildReference(input.points, frame))
      const lanes: GridBackend[] = []
      const compiled: string[] = []
      try {
        for (const residual of [true, false]) {
          vi.mocked(builder).mockImplementation(shader => {
            let source = original(shader)
            if (residual) {
              source = replaceOnce(source, 'return roundedQuotient(a, b);', 'let q = a / b; return q + fma(-q, b, a) / b;')
              source = replaceOnce(source, 'return roundedRoot(a);', 'let q = sqrt(a); return q + fma(-q, q, a) / (2. * q);')
            }
            compiled.push(source)
            return source
          })
          lanes.push(await createGridWebGPU(document.createElement('canvas'), input, PARAMETERS, frame, mode))
        }
        expect(compiled).toHaveLength(2)
        expect(compiled[0]).toContain('return q + fma(-q, b, a) / b;')
        expect(compiled[0]).not.toContain('return roundedQuotient(a, b);')
        expect(compiled[1]).toContain('return roundedQuotient(a, b);')
        expect(compiled[1]).not.toContain('fma(')
        const validation: ReturnType<typeof comparePresent>[][] = [[], []]
        const samples: Measurement[][] = [[], []]
        const run = async (lane: number, operations: number): Promise<Measurement> => {
          const result = await lanes[lane].measure('step', operations).catch(error => {
            throw new Error(`${count}/${mode}/${lane === 0 ? 'residual' : 'integer-midpoint'}/batch=${operations}: ${String(error)}`)
          })
          const check = comparePresent(result.snapshot, expected, input.points)
          validation[lane].push(check)
          if (lane === 1) expect(check.valid, JSON.stringify({ count, mode, check })).toBe(true)
          return result.timing
        }
        const pilots = [await run(0, 1), await run(1, 1)]
        // Cap slow software batches instead of raising the GPU timeout.
        const completionLimit = Math.max(1, Math.floor(1000 / Math.max(...pilots.map(p => p.batchCompletionMs))))
        const operations = Math.min(chooseOperations(pilots), completionLimit)
        for (let round = 0; round < TIMING_POLICY.warmups + TIMING_POLICY.samples; round++) {
          for (let offset = 0; offset < 2; offset++) {
            const lane = (round + offset) % 2
            const sample = await run(lane, operations)
            if (round >= TIMING_POLICY.warmups) samples[lane].push(sample)
          }
        }
        const record = {
          count,
          mode,
          operations,
          device: lanes[1].info,
          rows: ['residual', 'integer-midpoint'].map((arithmetic, lane) => ({ arithmetic, validation: validation[lane], ...summarize(samples[lane]) })),
        }
        // One distinct ignored file per case also retains completed cases on cancellation.
        await expect(JSON.stringify(record, null, 2)).toMatchFileSnapshot(`../../../captures/far-arithmetic-cost-${count}-${mode}.json`)
      } finally {
        lanes.forEach(lane => lane.destroy())
        vi.mocked(builder).mockImplementation(original)
      }
    }, 180000)
  }
}
