import { describe, expect, it } from 'vitest'
import { createSpatialGridResources } from '../spatial-grid/resources'
import { createNeighborhoodBackend } from './backend'
import { diagnoseContributions } from './precision'
import { createPositions, DEFAULT_PARAMETERS, forceAt } from './reference'
import shader from './shaders/forces.wgsl?raw'
import chunkedShader from './shaders/forces-chunked.wgsl?raw'

async function adapterForTest (): Promise<GPUAdapter | null> {
  const adapter = await navigator.gpu?.requestAdapter() ?? null
  if (!adapter && import.meta.env.REQUIRE_WEBGPU) throw new Error('WebGPU required')
  return adapter
}

describe('dense precision regression', () => {
  it('reduces loss between large opposing sums without claiming exact f32 arithmetic', () => {
    const contributions = new Float32Array(65536 * 4)
    for (let i = 0; i < 65536; i += 1) {
      contributions[i * 4] = i < 16384 ? 1 : i < 49152 ? 0.0001 : -1
      contributions[i * 4 + 2] = 1
      contributions[i * 4 + 3] = 1
    }
    const expected = [32768 * Math.fround(0.0001) * Math.fround(0.12), 0]
    const tolerance = 0.0002 + 0.0002 * Math.hypot(...expected)
    const result = diagnoseContributions(contributions, 0.12,
      { index: 0, expected, actual: [0, 0], error: 0, tolerance, ratio: 0 })
    expect(result.serialError).toBeGreaterThan(tolerance)
    // This deliberately adversarial sequence is not a graph fixture: blocking reduces, not eliminates, error.
    expect(result.blockedError).toBeLessThan(result.serialError / 50)
    expect(result.doubleError).toBeLessThan(1e-12)
    expect(result.neighbors).toBe(65536)
  })

  it('keeps the exact neighbor count for the captured one-ULP cutoff pair', async context => {
    const adapter = await adapterForTest()
    if (!adapter) { context.skip(); return }
    const device = await adapter.requestDevice()
    const positions = new Float32Array([0.009062548168003559, -0.2185899317264557, -0.10604944080114365, -0.10746285319328308])
    const parameters = { ...DEFAULT_PARAMETERS, radius: 0.16 }
    try {
      expect(forceAt(positions, 0, parameters)[2]).toBe(1)
      for (const [method, accumulation] of [['brute', 'blocked'], ['grid', 'blocked'], ['grid', 'chunked']] as const) {
        const backend = await createNeighborhoodBackend(device, positions, parameters, 64, method, undefined, accumulation)
        try { expect(await backend.validate()).toMatchObject({ valid: true, neighborMismatches: 0, meanNeighbors: 1 }) } finally {
          backend.destroy()
        }
      }
    } finally { device.destroy() }
  })

  it('rounds positive sums including ties, exponent gaps and mantissa carry', async context => {
    const adapter = await adapterForTest()
    if (!adapter) { context.skip(); return }
    const device = await adapter.requestDevice()
    const pairs = [[0, 0], [0, 1], [1, 2 ** -24], [1 + 2 ** -23, 2 ** -24],
      [2 - 2 ** -23, 2 ** -24], [2 ** -100, 1], [0.013250770978629589, 0.01234922744333744]]
    let random = 42
    for (let i = 0; i < 1000; i += 1) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      pairs.push([(random / 0x100000000) * 2 ** -(i % 100), 2 ** -((i * 7) % 100)])
    }
    const data = new Float32Array(pairs.flat())
    const input = device.createBuffer({ size: data.byteLength, usage: 128 | 8 })
    const output = device.createBuffer({ size: pairs.length * 4, usage: 128 | 4 })
    const readback = device.createBuffer({ size: output.size, usage: 8 | 1 })
    try {
      const helper = shader.slice(shader.indexOf('fn addPositiveRounded'), shader.indexOf('fn contribution'))
      const code = `${helper}
        @group(0) @binding(0) var<storage, read> input: array<vec2f>;
        @group(0) @binding(1) var<storage, read_write> output: array<f32>;
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
          if (id.x < arrayLength(&input)) { output[id.x] = addPositiveRounded(input[id.x].x, input[id.x].y); }
        }`
      const pipeline = await device.createComputePipelineAsync({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
      })
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: output } },
        ],
      })
      device.queue.writeBuffer(input, 0, data)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(pairs.length / 64)); pass.end()
      encoder.copyBufferToBuffer(output, 0, readback, 0, output.size)
      device.queue.submit([encoder.finish()])
      await readback.mapAsync(1)
      expect(Array.from(new Float32Array(readback.getMappedRange()))).toEqual(pairs.map((_, i) => Math.fround(data[i * 2] + data[i * 2 + 1])))
    } finally { input.destroy(); output.destroy(); readback.destroy(); device.destroy() }
  })

  it.for([['blocked', shader], ['chunked', chunkedShader]])('%s meets dense tolerance on every grid size', async ([, shader], context) => {
    const adapter = await adapterForTest()
    if (!adapter) { context.skip(); return }
    const device = await adapter.requestDevice()
    const positions = createPositions(65536, 'uniform', 16)
    const parameters = { ...DEFAULT_PARAMETERS, radius: 0.16 }
    const targets = [9096, 10249, 11082, 30445, 38052, 53619, 58310, 61406, 65470]
    const expected = targets.map(index => forceAt(positions, index, parameters))
    const positionBuffer = device.createBuffer({ size: positions.byteLength, usage: 128 | 8 })
    const forces = device.createBuffer({ size: 65536 * 16, usage: 128 | 4 })
    const uniforms = device.createBuffer({ size: 32, usage: 64 | 8 })
    const readback = device.createBuffer({ size: 16, usage: 8 | 1 })
    const errors: string[] = []
    device.addEventListener('uncapturederror', event => errors.push(event.error.message))
    try {
      // Run the production grid body for one target at a time, avoiding billions of software-GPU operations.
      const code = shader.replace('fn grid(@builtin(global_invocation_id) global: vec3u) {\n  let i = global.x;',
        'fn grid(@builtin(global_invocation_id) global: vec3u) {\n  if (global.x != 0u) { return; }\n  let i = params.diagnosticIndex;')
      expect(code).not.toBe(shader)
      const pipeline = await device.createComputePipelineAsync({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code }), entryPoint: 'grid' },
      })
      device.queue.writeBuffer(positionBuffer, 0, positions as Float32Array<ArrayBuffer>)
      for (const gridSize of [16, 32, 64]) {
        const grid = createSpatialGridResources(device, [positionBuffer], 65536, gridSize)
        try {
          const build = device.createCommandEncoder(); grid.encodeBuild(build); device.queue.submit([build.finish()])
          const group = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries:
            [positionBuffer, forces, uniforms, grid.cellOffsets, grid.pointIndices].map((buffer, binding) => ({ binding, resource: { buffer } })),
          })
          for (const [target, target_] of targets.entries()) {
            const params = new ArrayBuffer(32)
            new Uint32Array(params).set([65536, gridSize])
            new Uint32Array(params)[6] = target_
            new Float32Array(params).set([0.16, 0.12, 1 / 60, 0.95], 2)
            device.queue.writeBuffer(uniforms, 0, params)
            const encoder = device.createCommandEncoder()
            const pass = encoder.beginComputePass()
            pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(1); pass.end()
            encoder.copyBufferToBuffer(forces, target_ * 16, readback, 0, 16)
            device.queue.submit([encoder.finish()]); await readback.mapAsync(1)
            const actual = new Float32Array(readback.getMappedRange()).slice(); readback.unmap()
            expect(actual[2], `grid ${gridSize}, point ${target_} neighbors`).toBe(expected[target][2])
            const error = Math.hypot(actual[0] - expected[target][0], actual[1] - expected[target][1])
            const tolerance = 0.0002 + 0.0002 * Math.hypot(expected[target][0], expected[target][1])
            expect(error, `grid ${gridSize}, point ${target_} force`).toBeLessThanOrEqual(tolerance)
          }
        } finally { grid.destroy() }
      }
      expect(errors).toEqual([])
    } finally { positionBuffer.destroy(); forces.destroy(); uniforms.destroy(); readback.destroy(); device.destroy() }
  })
})
