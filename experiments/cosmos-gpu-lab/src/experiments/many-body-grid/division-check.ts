import { Buffer, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, upload } from '../../gpu/luma'
import division from './divide-by-count.wgsl?raw'
export type DivisionCheck = { cases: number; mismatches: number; firstFailure: number | null }
export function divisionCases (): { inputs: Uint32Array; expected: Uint32Array } {
  const pairs: number[] = []
  let seed = 0x13459a2b
  for (let count = 1; count <= 16384; count++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const random = ((seed & 0x807fffff) | ((count % 255) << 23)) >>> 0
    for (const bits of [0x00800000, 0x007fffff, 1, 0x3f800000, 0x3f800001, 0x7f7fffff, random, random ^ 0x80000000]) {
      pairs.push(bits, count)
    }
  }
  // Ties to even, signed underflow and the subnormal-to-normal rounding carry.
  for (const bits of [0, 0x80000000, 3, 5, 0x80000003, 0x80000005, 0x00ffffff, 0x80ffffff]) pairs.push(bits, 2)
  const inputs = new Uint32Array(pairs)
  const values = new Float32Array(inputs.buffer)
  const expectedValues = new Float32Array(inputs.length / 2)
  for (let i = 0; i < expectedValues.length; i++) expectedValues[i] = values[i * 2] / inputs[i * 2 + 1]
  return { inputs, expected: new Uint32Array(expectedValues.buffer) }
}
// The bit-pattern output checks the arithmetic itself, including signed zero and
// subnormal encodings, without introducing another floating-point operation.
export async function verifyCountDivision (device: Device): Promise<DivisionCheck> {
  const { inputs, expected } = divisionCases()
  const owned: Array<{ destroy(): void }> = []
  const own = <T extends { destroy(): void }>(r: T): T => { owned.push(r); return r }
  try {
    const input = own(upload(device, inputs))
    const output = own(device.createBuffer({ byteLength: expected.byteLength, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const kernel = own(await Kernel.createAsync(device, {
      id: 'centroid-division-check',
      source: `${division}
@group(0) @binding(0) var<storage, read> input: array<vec2<u32>>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&input)) { return; }
  output[i] = bitcast<u32>(divideByCount(bitcast<f32>(input[i].x), input[i].y));
}`,
      shaderLayout: { bindings: bindingLayout([['input', 'read-only-storage'], ['output', 'storage']]) },
    }))
    const pass = device.beginComputePass()
    try { kernel.dispatch(pass, { x: Math.ceil(expected.length / 64), bindings: { input, output } }) } finally { pass.end() }
    device.submit()
    const bytes = await output.readAsync()
    const actual = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
    let mismatches = 0; let firstFailure: number | null = null
    for (const [i, element] of expected.entries()) {
      if (actual[i] !== element) { mismatches++; firstFailure ??= i }
    }
    return { cases: expected.length, mismatches, firstFailure }
  } finally { owned.reverse().forEach(r => r.destroy()) }
}
