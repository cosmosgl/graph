import { expect, it } from 'vitest'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, createDevice, readFloats, upload } from '../../gpu/luma'
import product from './rounded-product.wgsl?raw'

it('rounds finite-normal products, including halfway ties, without native multiply-add fusion', async () => {
  const values: number[] = []; const scratch = new Uint32Array(1); const float = new Float32Array(scratch.buffer)
  let seed = 0x12345678
  const random = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0 }
  for (let i = 0; i < 8192; i++) {
    for (let j = 0; j < 2; j++) {
      scratch[0] = (random() & 0x807fffff) | ((96 + random() % 63) << 23)
      values.push(float[0])
    }
  }
  for (const sign of [-1, 1]) for (const mantissa of [1, 3, 5, 7]) values.push(sign * (1 + mantissa * 2 ** -23), 1.5)
  const input = new Float32Array(values)
  const expected = Float32Array.from({ length: values.length / 2 }, (_, i) => Math.fround(input[i * 2] * input[i * 2 + 1]))
  const device = await createDevice('webgpu', undefined, false)
  const buffers = [upload(device, input), upload(device, new Float32Array(expected.length))]
  let kernel: Kernel | undefined
  try {
    kernel = await Kernel.createAsync(device, {
      source: `${product}
@group(0) @binding(0) var<storage, read> pairs: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x < arrayLength(&output)) { output[id.x] = roundedProduct(pairs[id.x].x, pairs[id.x].y); }
}`,
      shaderLayout: { bindings: bindingLayout([['pairs', 'read-only-storage'], ['output', 'storage']]) },
    })
    const pass = device.beginComputePass()
    try { kernel.dispatch(pass, { x: Math.ceil(expected.length / 64), bindings: { pairs: buffers[0], output: buffers[1] } }) } finally { pass.end() }
    device.submit()
    const actual = await readFloats(buffers[1])
    expect(new Uint32Array(actual.buffer)).toEqual(new Uint32Array(expected.buffer))
  } finally { kernel?.destroy(); buffers.forEach(b => b.destroy()); device.destroy() }
})
