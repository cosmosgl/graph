import { Kernel } from '@luma.gl/engine'
import { describe, expect, it } from 'vitest'
import { bindingLayout, readFloats } from '../../gpu/luma'
import { deviceForTest } from '../../gpu/test-device'
import { createSpatialGridResources } from '../spatial-grid/resources'
import { createNeighborhoodBackend } from './backend'
import { diagnoseContributions } from './precision'
import { createPositions, DEFAULT_PARAMETERS, forceAt } from './reference'
import shader from './shaders/forces.wgsl?raw'
import chunkedShader from './shaders/forces-chunked.wgsl?raw'

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
    const errors: string[] = []
    const device = await deviceForTest(false, errors)
    if (!device) { context.skip(); return }
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
    const errors: string[] = []
    const device = await deviceForTest(false, errors)
    if (!device) { context.skip(); return }
    const pairs = [[0, 0], [0, 1], [1, 2 ** -24], [1 + 2 ** -23, 2 ** -24],
      [2 - 2 ** -23, 2 ** -24], [2 ** -100, 1], [0.013250770978629589, 0.01234922744333744]]
    let random = 42
    for (let i = 0; i < 1000; i += 1) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      pairs.push([(random / 0x100000000) * 2 ** -(i % 100), 2 ** -((i * 7) % 100)])
    }
    const data = new Float32Array(pairs.flat())
    const input = device.createBuffer({ byteLength: data.byteLength, usage: 128 | 8 })
    const output = device.createBuffer({ byteLength: pairs.length * 4, usage: 128 | 4 })
    try {
      const helper = shader.slice(shader.indexOf('fn addPositiveRounded'), shader.indexOf('fn contribution'))
      const code = `${helper}
        @group(0) @binding(0) var<storage, read> input: array<vec2f>;
        @group(0) @binding(1) var<storage, read_write> output: array<f32>;
        @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
          if (id.x < arrayLength(&input)) { output[id.x] = addPositiveRounded(input[id.x].x, input[id.x].y); }
        }`
      const kernel = await Kernel.createAsync(device, {
        source: code,
        shaderLayout: {
          bindings: bindingLayout([
            ['input', 'read-only-storage'], ['output', 'storage'],
          ]),
        },
      })
      try {
        input.write(data)
        const pass = device.beginComputePass()
        kernel.dispatch(pass, { x: Math.ceil(pairs.length / 64), bindings: { input, output } }); pass.end(); device.submit()
        expect(Array.from(await readFloats(output))).toEqual(pairs.map((_, i) => Math.fround(data[i * 2] + data[i * 2 + 1])))
        expect(errors).toEqual([])
      } finally { kernel.destroy() }
    } finally { input.destroy(); output.destroy(); device.destroy() }
  })

  it.for([['blocked', shader], ['chunked', chunkedShader]])('%s meets dense tolerance on every grid size', async ([, shader], context) => {
    const errors: string[] = []
    const device = await deviceForTest(false, errors)
    if (!device) { context.skip(); return }
    const positions = createPositions(65536, 'uniform', 16)
    const parameters = { ...DEFAULT_PARAMETERS, radius: 0.16 }
    const targets = [9096, 10249, 11082, 30445, 38052, 53619, 58310, 61406, 65470]
    const expected = targets.map(index => forceAt(positions, index, parameters))
    const positionBuffer = device.createBuffer({ byteLength: positions.byteLength, usage: 128 | 8 })
    const forces = device.createBuffer({ byteLength: 65536 * 16, usage: 128 | 4 })
    const uniforms = device.createBuffer({ byteLength: 32, usage: 64 | 8 })
    try {
      // Run the production grid body for one target at a time, avoiding billions of software-GPU operations.
      const code = shader.replace('fn grid(@builtin(global_invocation_id) global: vec3u) {\n  let i = global.x;',
        'fn grid(@builtin(global_invocation_id) global: vec3u) {\n  if (global.x != 0u) { return; }\n  let i = params.diagnosticIndex;')
      expect(code).not.toBe(shader)
      const kernel = await Kernel.createAsync(device, {
        source: code,
        entryPoint: 'grid',
        shaderLayout: {
          bindings: bindingLayout([
            ['positions', 'read-only-storage'], ['forces', 'storage'], ['params', 'uniform'],
            ['offsets', 'read-only-storage'], ['indices', 'read-only-storage'],
          ]),
        },
      })
      positionBuffer.write(positions)
      try {
        for (const gridSize of [16, 32, 64]) {
          const grid = createSpatialGridResources(device, [positionBuffer], 65536, gridSize)
          try {
            const build = device.createCommandEncoder(); grid.encodeBuild(build); device.submit(build.finish())
            const bindings = { positions: positionBuffer, forces, params: uniforms, offsets: grid.cellOffsets, indices: grid.pointIndices }
            for (const [target, target_] of targets.entries()) {
              const params = new ArrayBuffer(32)
              new Uint32Array(params).set([65536, gridSize])
              new Uint32Array(params)[6] = target_
              new Float32Array(params).set([0.16, 0.12, 1 / 60, 0.95], 2)
              uniforms.write(new Uint8Array(params))
              const pass = device.beginComputePass()
              kernel.dispatch(pass, { x: 1, bindings }); pass.end(); device.submit()
              const bytes = await forces.readAsync(target_ * 16, 16)
              const actual = new Float32Array(bytes.buffer, bytes.byteOffset, 4)
              expect(actual[2], `grid ${gridSize}, point ${target_} neighbors`).toBe(expected[target][2])
              const error = Math.hypot(actual[0] - expected[target][0], actual[1] - expected[target][1])
              const tolerance = 0.0002 + 0.0002 * Math.hypot(expected[target][0], expected[target][1])
              expect(error, `grid ${gridSize}, point ${target_} force`).toBeLessThanOrEqual(tolerance)
            }
          } finally { grid.destroy() }
        }
        expect(errors).toEqual([])
      } finally { kernel.destroy() }
    } finally { positionBuffer.destroy(); forces.destroy(); uniforms.destroy(); device.destroy() }
  })
})
