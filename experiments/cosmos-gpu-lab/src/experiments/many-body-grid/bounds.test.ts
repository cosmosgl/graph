import { expect, it } from 'vitest'
import { createDevice, readFloats, upload } from '../../gpu/luma'
import { createGpuBounds } from './bounds'
import { frameFor, layout } from './data'

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('reduces bounds and reproduces CPU frame bits across padding, levels, absence and ticks', async () => {
  const device = await createDevice('webgpu', undefined, false)
  try {
    for (const count of [0, 1, 255, 256, 257, 8192, 65537]) {
      const points = new Float32Array(count * 4)
      for (let i = 0; i < count; i++) points.set([Math.sin(i * 0.73) * 123.5, Math.cos(i * 0.57) * 51.25, i % 2, 0], i * 4)
      if (count > 1) points.set([NaN, Infinity, 0, 1], 4)
      const positions = upload(device, points); const box = upload(device, new Float32Array(4))
      const bounds = await createGpuBounds(device, count, layout(count).finest, box)
      try {
        for (const tick of [0, 1, 99]) {
          bounds.prepare(tick)
          const pass = device.beginComputePass()
          try { bounds.encode(pass, positions) } finally { pass.end() }
          device.submit()
          const actual = await readFloats(box)
          expect(new Uint32Array(actual.buffer), `count ${count}, tick ${tick}`)
            .toEqual(new Uint32Array(frameFor(points, tick).bounds.buffer))
        }
        // Reuse storage: all absent, then all coincident (including signed zero).
        for (const absent of [1, 0]) {
          for (let i = 0; i < count; i++) points.set([-0, 0, 1, absent], i * 4)
          if (count) positions.write(points)
          bounds.prepare(5)
          const pass = device.beginComputePass()
          try { bounds.encode(pass, positions) } finally { pass.end() }
          device.submit()
          const actual = await readFloats(box)
          expect(new Uint32Array(actual.buffer), `count ${count}, absent ${absent}`)
            .toEqual(new Uint32Array(frameFor(points, 5).bounds.buffer))
        }
      } finally { bounds.destroy(); box.destroy(); positions.destroy() }
    }
  } finally { device.destroy() }
})
