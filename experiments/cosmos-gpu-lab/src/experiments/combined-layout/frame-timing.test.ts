import { expect, it } from 'vitest'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, createDevice, upload } from '../../gpu/luma'
import { measureFrameBatch } from './frame-timing'
it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('pairs compute-pass timestamps and runs every dispatch in every frame', async () => {
  const device = await createDevice('webgpu', undefined, true)
  const data = upload(device, new Uint32Array(4))
  const kernel = await Kernel.createAsync(device, {
    source: `
@group(0) @binding(0) var<storage, read_write> value: array<u32>;
@compute @workgroup_size(1) fn main() { value[0] += 1u; }`,
    shaderLayout: { bindings: bindingLayout([['value', 'storage']]) },
  })
  try {
    const timing = await measureFrameBatch(device, 3, 1, (query, frame) => {
      const pass = device.beginComputePass(query
        ? {
          timestampQuerySet: query, beginTimestampIndex: frame * 2, endTimestampIndex: frame * 2 + 1,
        }
        : {})
      try {
        for (let i = 0; i < 2; i++) kernel.dispatch(pass, { x: 1, bindings: { value: data } })
      } finally { pass.end() }
    })
    expect(timing.timerStatus).toBe(device.features.has('timestamp-query') ? 'valid' : 'unavailable')
    if (device.features.has('timestamp-query')) {
      expect(timing.batchGpuMs).toBeGreaterThanOrEqual(0)
      expect(timing.frameGpuMs).toHaveLength(3)
      expect(timing.frameGpuMs.reduce<number>((sum, n) => sum + n!, 0)).toBeCloseTo(timing.batchGpuMs!, 10)
    }
    const bytes = await data.readAsync(); expect(new Uint32Array(bytes.buffer, bytes.byteOffset, 4)[0]).toBe(6)
  } finally { kernel.destroy(); data.destroy(); device.destroy() }
})
