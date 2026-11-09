import { describe, expect, it } from 'vitest'
import { createNeighborhoodBackend } from './backend'
import { createPrecisionPlan } from './precision-comparison'
import { chooseBatchSize, decodeTimestamps } from './gpu-timer'
import { createPositions, DEFAULT_PARAMETERS } from './reference'
import { createSweepPlan, methodOrder, runSweep } from './sweep'

describe('measurement and sweep contracts', () => {
  it('repeats every precision comparison configuration four times in a reproducible order', () => {
    const plan = createPrecisionPlan()
    expect(createPrecisionPlan()).toEqual(plan)
    expect(plan).toHaveLength(36)
    const configurations = new Set(plan.map(row => `${row.scenario}/${row.gridSize}`))
    expect(configurations.size).toBe(9)
    for (const configuration of configurations) {
      expect(plan.filter(row => `${row.scenario}/${row.gridSize}` === configuration)
        .map(row => row.repetition).sort()).toEqual([0, 1, 2, 3])
    }
  })

  it('calibrates bounded batches and uses wall time only when GPU timing is unavailable', () => {
    expect(chooseBatchSize(0, 8)).toBe(64)
    expect(chooseBatchSize(0.125, 8)).toBe(32)
    expect(chooseBatchSize(10, 8)).toBe(1)
    expect(chooseBatchSize(null, 0.5)).toBe(8)
    expect(chooseBatchSize(null, NaN)).toBe(1)
  })

  it('subtracts 64-bit timestamps before converting units, preserves zeros and rejects counter resets', () => {
    const base = 2n ** 60n
    expect(decodeTimestamps(base, base + 123456n).milliseconds).toBe(0.123456)
    expect(decodeTimestamps(base, base).milliseconds).toBe(0)
    expect(decodeTimestamps(base, base - 1n).milliseconds).toBeNull()
    expect(decodeTimestamps(0n, 2n ** 60n).milliseconds).toBeNull()
    expect(decodeTimestamps(base, base).startNanoseconds).toBe(base.toString())
  })

  it('covers the Cartesian product reproducibly and reverses each method pair on repetition', () => {
    const plan = createSweepPlan('quick', 2, 42)
    expect(plan).toHaveLength(32)
    expect(new Set(plan.map(row => JSON.stringify(row))).size).toBe(32)
    expect(createSweepPlan('quick', 2, 42)).toEqual(plan)
    expect(createSweepPlan('quick', 2, 43)).not.toEqual(plan)
    expect(createSweepPlan('standard', 1, 0)).toHaveLength(81)
    expect(createSweepPlan('large', 1, 0)).toHaveLength(108)
    for (const row of plan) {
      expect(methodOrder({ ...row, repetition: row.repetition + 1 })).toEqual(methodOrder(row).reverse())
    }
    expect(new Set(plan.filter(row => row.repetition === 0).map(row => methodOrder(row)[0])).size).toBe(2)
    expect(() => createSweepPlan('quick', 0, 42)).toThrow()
    expect(() => createSweepPlan('quick', 1, NaN)).toThrow()
  })

  it('varies occupied area independently of point count using the same positions', () => {
    const normal = createPositions(129, 'uniform', 1)
    const dense = createPositions(129, 'uniform', 4)
    expect(dense).toHaveLength(normal.length)
    for (let i = 0; i < normal.length; i += 1) expect(dense[i]).toBe(normal[i] / 2)
  })
})

describe('WebGPU measurements', () => {
  for (const timestamps of [false, true]) {
    it(`measures compute, multi-pass grid and rendering with timestamps ${timestamps ? 'enabled' : 'disabled'}`, async context => {
      const adapter = await navigator.gpu?.requestAdapter()
      if (!adapter) {
        if (import.meta.env.REQUIRE_WEBGPU) throw new Error('WebGPU required for this test')
        context.skip(); return
      }
      if (timestamps && !adapter.features.has('timestamp-query')) { context.skip(); return }
      const device = await adapter.requestDevice({ requiredFeatures: timestamps ? ['timestamp-query'] : [] })
      const errors: string[] = []
      device.addEventListener('uncapturederror', event => errors.push(event.error.message))
      try {
        for (const method of ['brute', 'grid'] as const) {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 48
          const backend = await createNeighborhoodBackend(device, createPositions(129, 'uniform'), DEFAULT_PARAMETERS, 16, method, canvas)
          try {
            const results = await backend.benchmark(() => false, 3)
            expect(results.map(result => result.stage)).toEqual(method === 'grid'
              ? ['grid', 'force', 'integration', 'render', 'tick']
              : ['force', 'integration', 'render', 'tick'])
            for (const result of results) {
              expect(result.samples).toHaveLength(8)
              expect(result.batchSize).toBeGreaterThanOrEqual(1)
              expect(result.batchSize).toBeLessThanOrEqual(64)
              expect(result.samples).toEqual(result.batchCompletionSamples.map(value => value / result.batchSize))
              expect(result.submitSamples).toEqual(result.batchSubmitSamples.map(value => value / result.batchSize))
              if (timestamps) {
                expect(result.timestamps).toHaveLength(8)
                expect(result.gpuSamples).toEqual(result.timestamps!.flatMap(sample =>
                  sample.milliseconds === null ? [] : [sample.milliseconds / result.batchSize]))
                expect(result.gpu).not.toBeNull()
                expect(result.gpu!.p50).toBeGreaterThanOrEqual(0)
                expect(result.timestamps!.every(sample => sample.milliseconds === null || sample.milliseconds >= 0)).toBe(true)
              } else {
                expect(result.timestamps).toBeNull()
                expect(result.gpu).toBeNull()
              }
            }
            expect(results.every(result => result.batchSize === 3)).toBe(true)
            expect(backend.ticks).toBe(0)
            expect((await backend.validate()).valid).toBe(true)
          } finally { backend.destroy() }
        }
        expect(errors).toEqual([])
      } finally { device.destroy() }
    })
  }

  it('retains completed sweep rows when cancelled between methods', async context => {
    const adapter = await navigator.gpu?.requestAdapter()
    if (!adapter) {
      if (import.meta.env.REQUIRE_WEBGPU) throw new Error('WebGPU required')
      context.skip(); return
    }
    const device = await adapter.requestDevice()
    try {
      let cancelled = false
      const results = await runSweep(device, createSweepPlan('quick', 1, 42), () => cancelled,
        () => { cancelled = true })
      expect(results).toHaveLength(1)
      expect(results[0].status).toBe('passed')
      expect(results[0].validation?.valid).toBe(true)
      expect(results[0].timings?.length).toBeGreaterThan(0)
      const empty = await runSweep(device, createSweepPlan('quick', 1, 42), () => true, () => {})
      expect(empty).toEqual([])
    } finally { device.destroy() }
  })

  it('records the all-pairs limit as a skip and validates a dense grid-only case', async context => {
    const adapter = await navigator.gpu?.requestAdapter()
    if (!adapter) {
      if (import.meta.env.REQUIRE_WEBGPU) throw new Error('WebGPU required')
      context.skip(); return
    }
    const device = await adapter.requestDevice()
    try {
      const results = await runSweep(device,
        [{ count: 4097, density: 16, radius: 0.16, gridSize: 64, repetition: 0 }], () => false, () => {})
      expect(results.find(row => row.method === 'brute')).toMatchObject({ status: 'skipped' })
      expect(results.find(row => row.method === 'brute')?.timings).toBeUndefined()
      expect(results.find(row => row.method === 'grid')).toMatchObject({ status: 'passed', validation: { valid: true } })
    } finally { device.destroy() }
  })
})
