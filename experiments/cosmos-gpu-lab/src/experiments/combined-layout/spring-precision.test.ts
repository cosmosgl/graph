import { expect, it } from 'vitest'
import { Buffer } from '@luma.gl/core'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { deviceForTest } from '../../gpu/test-device'
import { createRoundedKernel, roundedArithmetic } from './spring-precision'
import { createCombinedSession } from './session'
// SwiftShader loses its device compiling this module; run explicitly with LAB_NATIVE_GPU=1.
const nativeTest = it.skipIf(!import.meta.env.LAB_NATIVE_GPU)
nativeTest('luma rounded operations match float32 reference bits on finite-normal spring-scale inputs', async () => {
  const device = await deviceForTest(); if (!device) throw new Error('WebGPU required')
  const owned: Array<{ destroy(): void }> = []; const own = <T extends { destroy(): void }>(v: T): T => { owned.push(v); return v }
  try {
    const values = [-38.9498176574707, 45.7416877746582, 45.7416877746582, Math.fround(0.85), 0, 1, 1, -1]
    let seed = 31
    const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
    for (let i = 0; i < 2048; i++) {
      values.push((random() - 0.5) * 2 ** (Math.floor(random() * 40) - 20), 2 ** (Math.floor(random() * 40) - 20) * (0.5 + random()))
    }
    const pairs = new Float32Array(values); const input = own(upload(device, pairs))
    const output = own(device.createBuffer({ byteLength: pairs.length * 8, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const kernel = own(await createRoundedKernel(device, `${roundedArithmetic}
@group(0) @binding(0) var<storage, read> input: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> output: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&input)) { return; }
  let p = input[id.x]; output[id.x] = vec4f(springAdd(p.x,p.y), springMul(p.x,p.y), springDiv(p.x,p.y), springRoot(abs(p.x)));
}`, bindingLayout([['input', 'read-only-storage'], ['output', 'storage']])))
    const pass = device.beginComputePass()
    try { kernel.dispatch(pass, { x: Math.ceil(pairs.length / 128), bindings: { input, output } }) } finally { pass.end() }
    device.submit()
    const actual = await readFloats(output); const expected = new Float32Array(actual.length)
    for (let i = 0; i < pairs.length; i += 2) {
      const a = pairs[i]; const b = pairs[i + 1]; expected.set([a + b, a * b, a / b, Math.sqrt(Math.abs(a))], i * 2)
    }
    expect(new Uint32Array(actual.buffer)).toEqual(new Uint32Array(expected.buffer))
  } finally { owned.reverse().forEach(v => v.destroy()); device.destroy() }
})
nativeTest('rounded force and integration preserve the existing spring budget on the first 2048-point star tick', async () => {
  const s = await createCombinedSession({ fixture: 'star', count: 2048, decay: 100, springPrecision: 'both' }, () => document.createElement('canvas'))
  try {
    expect(s.errors).toEqual({})
    const row = await s.step(); const gpu = row.results.find(r => r.name === 'webgpu')!
    expect(row.complete).toBe(true)
    expect(gpu.valid, JSON.stringify(gpu)).toBe(true)
  } finally { s.destroy() }
})

for (const fixture of ['star', 'communities'] as const) {
  for (const decay of [100, 300]) {
    nativeTest(`rounded ${fixture}, 2048 points, ${decay} ticks: original checkpoints and probe pass`, async () => {
      const s = await createCombinedSession({ fixture, count: 2048, decay, checkpointEvery: 10, springPrecision: 'both' },
        () => document.createElement('canvas'))
      try {
        for (let tick = 0; tick < decay; tick++) await s.step()
        expect(s.errors).toEqual({})
        expect(s.rows.every(r => r.complete)).toBe(true)
        const checks = s.rows.filter(r => r.checked).map(r => r.results.find(v => v.name === 'webgpu')!)
        expect(checks).toHaveLength(decay / 10 + 1)
        expect(checks.filter(r => !r.valid)).toEqual([])
        const probe = await s.probe()
        expect(probe.complete).toBe(true)
        expect(probe.results.find(r => r.name === 'webgpu')!.valid).toBe(true)
        // eslint-disable-next-line no-console
        console.info(JSON.stringify({
          fixture,
          count: 2048,
          decay,
          checks: checks.length,
          glFailed: s.rows.filter(r => r.results.some(v => v.name === 'webgl' && v.valid === false)).length,
          final: s.rows.at(-1)?.results.map(r => ({ name: r.name, drift: r.drift.rms })),
          probe: probe.results.map(r => ({ name: r.name, valid: r.valid })),
        }))
      } finally { s.destroy() }
    }, 180000)
  }
}
