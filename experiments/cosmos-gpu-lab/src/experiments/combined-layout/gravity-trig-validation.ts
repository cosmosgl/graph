import { bindingLayout, createDevice, readFloats, upload } from '../../gpu/luma'
import { createRoundedKernel, roundedArithmetic } from './spring-precision'
import trigSource from './gravity-trig.wgsl?raw'
export type TrigValidation = { cases: number; differing: number[]; examples: Array<{ index: number; field: number; gpu: number; cpu: number }> }
export async function validateGravityTrig (): Promise<TrigValidation> {
  const pairs = [0, 1, -0, 1, 0, -1, -0, -1, 1, 0, -1, 0]
  let seed = 5931
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < 4096; i++) {
    const angle = (i / 4095 * 2 - 1) * Math.PI
    pairs.push(Math.sin(angle), Math.cos(angle))
    pairs.push((random() - 0.5) * 2 ** Math.floor(random() * 25 - 12), (random() - 0.5) * 2 ** Math.floor(random() * 25 - 12))
  }
  const input = new Float32Array(pairs); const cases = input.length / 2
  const expected = new Float32Array(cases * 4)
  for (let i = 0; i < cases; i++) {
    const angle = Math.fround(Math.atan2(input[i * 2], input[i * 2 + 1]))
    expected.set([angle, Math.sin(angle), Math.cos(angle), 0], i * 4)
  }
  const device = await createDevice('webgpu', undefined, false)
  const owned: Array<{ destroy(): void }> = []; const own = <T extends { destroy(): void }>(r: T): T => { owned.push(r); return r }
  try {
    const vectors = own(upload(device, input)); const output = own(upload(device, new Float32Array(expected.length).fill(NaN)))
    const kernel = own(await createRoundedKernel(device, `${roundedArithmetic + trigSource}
@group(0) @binding(0) var<storage, read> vectors: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&vectors)) { return; }
  let angle = gravityAngle(vectors[id.x].x, vectors[id.x].y);
  let sc = gravitySinCos(vec2f(angle, 0.));
  output[id.x] = vec4f(angle, sc.sine.x, sc.cosine.x, 0.);
}`, bindingLayout([['vectors', 'read-only-storage'], ['output', 'storage']])))
    const pass = device.beginComputePass()
    try { kernel.dispatch(pass, { x: Math.ceil(cases / 64), bindings: { vectors, output } }) } finally { pass.end() }
    device.submit()
    const actual = await readFloats(output); const a = new Uint32Array(actual.buffer); const b = new Uint32Array(expected.buffer)
    const result: TrigValidation = { cases, differing: [0, 0, 0], examples: [] }
    for (let i = 0; i < cases; i++) {
      for (let j = 0; j < 3; j++) {
        if (a[i * 4 + j] !== b[i * 4 + j]) {
          result.differing[j]++
          if (result.examples.length < 8) result.examples.push({ index: i, field: j, gpu: actual[i * 4 + j], cpu: expected[i * 4 + j] })
        }
      }
    }
    return result
  } finally { try { owned.reverse().forEach(r => r.destroy()) } finally { device.destroy() } }
}
