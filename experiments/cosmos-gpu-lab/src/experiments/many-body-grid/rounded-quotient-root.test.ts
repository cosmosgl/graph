import { expect, it } from 'vitest'
import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { deviceForTest } from '../../gpu/test-device'
import { bindingLayout, upload } from '../../gpu/luma'
import arithmetic from './rounded-quotient-root.wgsl?raw'

async function run (source: string, values: Uint32Array, outputWords: number): Promise<Uint32Array> {
  const device = await deviceForTest()
  if (!device) throw new Error('Arithmetic regression requires WebGPU')
  const owned: Array<{ destroy(): void }> = []
  const own = <T extends { destroy(): void }>(r: T): T => { owned.push(r); return r }
  try {
    const input = own(upload(device, values))
    const output = own(device.createBuffer({ byteLength: outputWords * 4, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const kernel = own(await Kernel.createAsync(device, {
      id: 'quotient-root-rounding',
      source: arithmetic + source,
      shaderLayout: { bindings: bindingLayout([['input', 'read-only-storage'], ['output', 'storage']]) },
    }))
    const pass = device.beginComputePass()
    try { kernel.dispatch(pass, { x: Math.ceil(outputWords / 64), bindings: { input, output } }) } finally { pass.end() }
    device.submit()
    const bytes = await output.readAsync()
    return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice()
  } finally { owned.reverse().forEach(r => r.destroy()); device.destroy() }
}

it('rounds quotient and root bit-for-bit across the recorded division probe, signs and normal exponents', async () => {
  const pairs: number[] = []; const f = Math.fround
  // Same seeded 4,096 pairs that exposed 418 bad residual corrections on SwiftShader.
  let seed = 123
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let i = 0; i < 4096; i++) pairs.push(f(0.001 + random() / 4294967296 * 3000), f(0.001 + random() / 4294967296 * 3000))
  const word = new Uint32Array(1); const float = new Float32Array(word.buffer)
  const value = (bits: number): number => { word[0] = bits; return float[0] }
  for (let exponent = 1; exponent < 255; exponent++) {
    for (let i = 0; i < 64; i++) {
      const fraction = i < 4 ? [0, 1, 0x7ffffe, 0x7fffff][i] : random() & 0x7fffff
      const a = value((exponent << 23) | fraction)
      // Same-exponent, unit, and nearby-exponent divisors exercise normalization.
      const b = value((Math.max(1, Math.min(254, exponent + (i % 5) - 2)) << 23) | (random() & 0x7fffff))
      pairs.push(a, b, -a, b, a, -b, -a, -b, a, 1)
    }
  }
  pairs.push(0, 1, -0, 1, 0, -1, -0, -1)
  // Radicands from the dense far-cell failure, plus both sides of unity.
  for (const a of [2281.84375, 2479.135986328125, value(0x3f7fffff), 1, value(0x3f800001)]) pairs.push(a, 1)
  const inputs = new Float32Array(pairs)
  const expected = new Float32Array(inputs.length)
  for (let i = 0; i < inputs.length; i += 2) {
    expected[i] = inputs[i] / inputs[i + 1]
    expected[i + 1] = Math.sqrt(Math.abs(inputs[i]))
  }
  const actual = await run(`
@group(0) @binding(0) var<storage, read> input: array<vec2<u32>>;
@group(0) @binding(1) var<storage, read_write> output: array<vec2<u32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= arrayLength(&input)) { return; }
  let pair = bitcast<vec2<f32>>(input[id.x]);
  output[id.x] = vec2(bitcast<u32>(roundedQuotient(pair.x, pair.y)), bitcast<u32>(roundedRoot(abs(pair.x))));
}`, new Uint32Array(inputs.buffer), expected.length)
  const bits = new Uint32Array(expected.buffer)
  const failures: unknown[] = []
  let mismatches = 0
  for (const [i, bit] of bits.entries()) {
    if (actual[i] !== bit) {
      mismatches++
      if (failures.length < 8) {
        failures.push({
          operation: i % 2 ? 'root' : 'divide', a: inputs[i & ~1], b: inputs[(i & ~1) + 1], expected: bit, actual: actual[i],
        })
      }
    }
  }
  expect(mismatches, JSON.stringify({ cases: inputs.length / 2, failures })).toBe(0)
})

it('uses exact midpoint ties and recovers from poor estimates without fma', async () => {
  const inputs: number[] = []; const expected: number[] = []
  // Exercise both root and division midpoint comparisons with exact integer targets.
  for (const m of [0x800002, 0x800003, 0xbffffe, 0xbfffff, 0xfffffe, 0xffffff]) {
    for (const divisor of [0, 0x800001, 0xffffff]) {
      const upper = BigInt(2 * m + 1)
      const midpoint = upper * (divisor === 0 ? upper : BigInt(divisor))
      for (const offset of [-1, 0, 1]) {
        const target = midpoint + BigInt(offset)
        const answer = offset < 0 ? m : offset > 0 ? m + 1 : m + (m & 1)
        for (const estimate of [m, m - 4, m + 4, 0, 0xffffffff]) {
          inputs.push(estimate, Number(target & 0xffffffffn), Number(target >> 32n), divisor)
          expected.push(answer)
        }
      }
    }
  }
  const actual = await run(`
@group(0) @binding(0) var<storage, read> input: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= arrayLength(&input)) { return; }
  let c = input[id.x]; output[id.x] = arithmeticRound(c.x, c.yz, c.w);
}`, new Uint32Array(inputs), expected.length)
  expect(actual).toEqual(new Uint32Array(expected))
})
