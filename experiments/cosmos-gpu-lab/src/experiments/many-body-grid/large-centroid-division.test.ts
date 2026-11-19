import { Buffer } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { expect, it } from 'vitest'
import { bindingLayout, createDevice, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { writeArtifact } from '../../testing/artifacts'
import division from './divide-by-count.wgsl?raw'

it.skipIf(!import.meta.env.LAB_REPULSION_DIVIDE)('checks sampled larger centroid denominators through one million', async () => {
  const counts = [16385, 20000, 32767, 32768, 65535, 65536, 65537, 100000, 250000, 500000, 999999, 1000000]
  let seed = 0x61739a21
  for (let i = 0; i < 4096; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; counts.push(16385 + seed % (1000000 - 16384)) }
  const pairs = new Uint32Array(counts.length * 8 * 2); let offset = 0
  for (const count of counts) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const random = ((seed & 0x807fffff) | ((count % 255) << 23)) >>> 0
    for (const bits of [0x00800000, 0x007fffff, 1, 0x3f800000, 0x3f800001, 0x7f7fffff, random, random ^ 0x80000000]) {
      pairs[offset++] = bits; pairs[offset++] = count
    }
  }
  const values = new Float32Array(pairs.buffer); const expectedFloat = new Float32Array(pairs.length / 2)
  for (let i = 0; i < expectedFloat.length; i++) expectedFloat[i] = values[i * 2] / pairs[i * 2 + 1]
  const expected = new Uint32Array(expectedFloat.buffer)
  const device = await createDevice('webgpu')
  const webgl = await createDevice('webgl', document.createElement('canvas'))
  const report: {
    sourceRevision: string; sourceSnapshot: string; browser: string; device: unknown; webgl: unknown; luma: string;
    counts: number; cases: number; minCount: number; maxCount: number; mismatches: number;
    examples: Array<{ valueBits: number; count: number; expectedBits: number; actualBits: number }>; status: string; error: string;
  } = {
    sourceRevision: import.meta.env.LAB_SOURCE_REVISION,
    sourceSnapshot: import.meta.env.LAB_SOURCE_SNAPSHOT,
    browser: navigator.userAgent,
    device: device.info,
    webgl: webgl.info,
    luma: '10.0.0-alpha.15',
    counts: counts.length,
    cases: expected.length,
    minCount: Math.min(...counts),
    maxCount: Math.max(...counts),
    mismatches: 0,
    examples: [],
    status: 'running',
    error: '',
  }
  webgl.destroy()
  const scope = resourceScope()
  try {
    if (!report.sourceRevision || !report.sourceSnapshot || device.info.fallback !== false) throw new Error('Source and non-fallback GPU are required')
    const input = scope.own(upload(device, pairs))
    const output = scope.own(device.createBuffer({ byteLength: expected.byteLength, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const kernel = scope.own(await Kernel.createAsync(device, {
      source: `${division}
@group(0) @binding(0) var<storage, read> input: array<vec2u>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < arrayLength(&input)) { output[id.x] = bitcast<u32>(divideByCount(bitcast<f32>(input[id.x].x), input[id.x].y)); }
}`,
      shaderLayout: { bindings: bindingLayout([['input', 'read-only-storage'], ['output', 'storage']]) },
    }))
    const pass = device.beginComputePass()
    try { kernel.dispatch(pass, { x: Math.ceil(expected.length / 64), bindings: { input, output } }) } finally { pass.end() }
    device.submit()
    const bytes = await output.readAsync()
    const actual = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
    for (const [i, element] of expected.entries()) {
      if (actual[i] === element) continue
      report.mismatches++
      if (report.examples.length < 10) {
        report.examples.push({
          valueBits: pairs[i * 2], count: pairs[i * 2 + 1], expectedBits: element, actualBits: actual[i],
        })
      }
    }
    report.status = 'complete'
  } catch (error) { report.status = 'error'; report.error = String(error) } finally {
    await writeArtifact('repulsion-large-division', report); scope.destroy(); device.destroy()
  }
  expect(report.error).toBe('')
  expect(report.mismatches).toBe(0)
}, 120000)
