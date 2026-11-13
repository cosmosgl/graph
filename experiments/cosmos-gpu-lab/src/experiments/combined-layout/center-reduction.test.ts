import { Buffer } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { createDevice, upload } from '../../gpu/luma'
import { createCenterWebGPU } from './center-webgpu'
import { centerAggregate } from './center-reference'

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('high/low center sum survives cancellation, masks, reduction boundaries and reuse', async () => {
  const device = await createDevice('webgpu')
  const capacity = 65537
  const positions = upload(device, new Float32Array(capacity * 4))
  const forces = device.createBuffer({ byteLength: capacity * 16, usage: Buffer.STORAGE })
  let center: Awaited<ReturnType<typeof createCenterWebGPU>> | undefined
  try {
    center = await createCenterWebGPU(device, 1, forces)
    // 65,537 requires three dispatches. Every input is stored f32, as in Cosmos.
    for (const count of [1, 255, 256, 257, 4097, 8192, 65537, 4]) {
      for (const fixture of ['offset', 'signed', 'masked', 'absent'] as const) {
        const input = new Float32Array(count * 4)
        for (let i = 0; i < count; i++) {
          input[i * 4] = (fixture === 'signed' ? (i % 2 ? -1 : 1) : 1) * (2048 + (i % 71) / 8192)
          input[i * 4 + 1] = (fixture === 'signed' ? (i % 3 ? -1 : 1) : 1) * (32768 + (i % 37) / 256)
          input[i * 4 + 2] = i % 7 === 0 ? 1 : 0
          if (fixture === 'absent' || (fixture === 'masked' && i % 3 === 0)) input.set([NaN, NaN, 0, 1], i * 4)
        }
        center.resize(count); positions.write(input)
        for (let repeat = 0; repeat < 2; repeat++) {
          const pass = device.beginComputePass()
          try { center.encode(pass, positions, 1, 1) } finally { pass.end() }
          device.submit()
          const actual = await center.read(); const expected = centerAggregate(input)
          expect(Array.from(new Uint32Array(actual.buffer)), `${count}/${fixture}/${repeat}`).toEqual(Array.from(new Uint32Array(expected.buffer)))
        }
      }
    }
  } finally { center?.destroy(); forces.destroy(); positions.destroy(); device.destroy() }
}, 120000)
