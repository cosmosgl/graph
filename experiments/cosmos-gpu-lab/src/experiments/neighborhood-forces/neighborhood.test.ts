import { describe, expect, it } from 'vitest'
import { createSpatialGridResources } from '../spatial-grid/resources'
import { createNeighborhoodBackend } from './backend'
import {
  createPositions, DEFAULT_PARAMETERS, forceAt, integratePoint, type Distribution,
} from './reference'

describe('neighborhood CPU reference', () => {
  it('excludes self and the exact cutoff, while separating coincidence symmetrically', () => {
    const parameters = { ...DEFAULT_PARAMETERS, radius: 0.125, strength: 1 }
    expect(forceAt(new Float32Array([0, 0]), 0, parameters)).toEqual([0, 0, 0])
    expect(forceAt(new Float32Array([0, 0, 0.125, 0]), 0, parameters)).toEqual([0, 0, 0])
    const pair = new Float32Array([0, 0, 0.0625, 0])
    expect(forceAt(pair, 0, parameters)).toEqual([-0.5, 0, 1])
    expect(forceAt(pair, 1, parameters)).toEqual([0.5, 0, 1])
    expect(forceAt(new Float32Array([0, 0, 0, 0]), 0, parameters)).toEqual([-1, 0, 1])
    expect(forceAt(new Float32Array([0, 0, 0, 0]), 1, parameters)).toEqual([1, 0, 1])
  })

  it('caps speed and reflects the offending velocity component at walls', () => {
    const result = integratePoint([1, 0], [0.5, 0], [100, 0], DEFAULT_PARAMETERS)
    expect(result.position).toEqual([1, 0])
    expect(result.velocity).toEqual([-0.25, 0])
  })
})

describe('neighborhood WebGPU pipelines', () => {
  for (const [count, distribution, radius, gridSize] of [
    [1, 'uniform', 0.08, 16],
    [129, 'boundary', 0.16, 64],
    [257, 'clusters', 0.08, 32],
    [513, 'diagonal', 0.04, 16],
    [1025, 'uniform', 0.16, 64],
  ] as Array<[number, Distribution, number, number]>) {
    it(`matches the CPU for ${count} ${distribution} points, radius ${radius}, grid ${gridSize}`, async context => {
      const adapter = await navigator.gpu?.requestAdapter()
      if (!adapter) {
        if (import.meta.env.REQUIRE_WEBGPU) throw new Error('WebGPU adapter required by test:gpu')
        context.skip(); return
      }
      const device = await adapter.requestDevice()
      const errors: string[] = []
      device.addEventListener('uncapturederror', event => errors.push(event.error.message))
      try {
        let baselineCandidates: number | undefined
        for (const [method, accumulation] of [['brute', 'blocked'], ['grid', 'blocked'], ['grid', 'chunked']] as const) {
          const backend = await createNeighborhoodBackend(device, createPositions(count, distribution),
            { ...DEFAULT_PARAMETERS, radius }, gridSize, method, undefined, accumulation)
          try {
            const first = await backend.validate()
            expect(first, `${method}: initial state`).toMatchObject({ valid: true, neighborMismatches: 0, nonFinite: 0 })
            if (method === 'grid' && accumulation === 'blocked') baselineCandidates = first.meanCandidates
            if (accumulation === 'chunked') expect(first.meanCandidates).toBe(baselineCandidates)
            expect(backend.ticks).toBe(0)
            for (let tick = 0; tick < 5; tick += 1) await backend.step()
            expect(await backend.validate(), `${method}: evolved state`).toMatchObject({ valid: true })
            expect(backend.ticks).toBe(5)
            backend.reset()
            expect(await backend.validate(), `${method}: reset`).toMatchObject({ valid: true })
            expect(backend.ticks).toBe(0)
          } finally { backend.destroy() }
        }
        expect(errors).toEqual([])
      } finally { device.destroy() }
    })
  }

  it('keeps borrowed positions and device alive and builds both ping-pong inputs', async context => {
    const adapter = await navigator.gpu?.requestAdapter()
    if (!adapter) {
      if (import.meta.env.REQUIRE_WEBGPU) throw new Error('WebGPU adapter required by test:gpu')
      context.skip(); return
    }
    const device = await adapter.requestDevice()
    const data = new Float32Array([-1, -1, 1, 1, 0, 0])
    const positions = [0, 1].map(() => device.createBuffer({ size: data.byteLength, usage: 128 | 8 | 4 }))
    device.pushErrorScope('validation')
    try {
      device.queue.writeBuffer(positions[0], 0, data)
      device.queue.writeBuffer(positions[1], 0, new Float32Array([-1, -1, -1, -1, -1, -1]))
      const grid = createSpatialGridResources(device, positions, data.length / 2, 16)
      for (let index = 0; index < 2; index += 1) {
        const encoder = device.createCommandEncoder()
        grid.encodeBuild(encoder, index)
        device.queue.submit([encoder.finish()])
        const result = await grid.readback()
        expect(result.counts[0]).toBe(index === 0 ? 1 : 3)
        expect(result.offsets[256]).toBe(3)
        expect(Array.from(result.pointIndices).sort()).toEqual([0, 1, 2])
      }
      grid.destroy()
      device.queue.writeBuffer(positions[0], 0, data)
      await device.queue.onSubmittedWorkDone()
      expect(await device.popErrorScope()).toBeNull()
    } finally {
      positions.forEach(position => position.destroy())
      device.destroy()
    }
  })
})
