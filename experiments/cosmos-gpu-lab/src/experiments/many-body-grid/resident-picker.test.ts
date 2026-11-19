import { expect, it } from 'vitest'
import { createDevice, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { createResidentPicker } from './resident-picker'

it('picks the last visible point at a framebuffer pixel and reads back one ID', async () => {
  const errors: string[] = []
  const device = await createDevice('webgpu', undefined, false, error => errors.push(error.message))
  const scope = resourceScope()
  try {
    expect(device.info.fallback).toBe(false)
    const count = 67
    const positions = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) positions[i * 4 + 3] = 1
    positions.set([
      -8, 0, 0, 0,
      8, 0, 0, 0,
      0, 0, 0, 0,
      22, 0, 1, 0,
      32, 0, 0, 0,
      -24, 16, 0, 0,
    ])
    // The overlapping winner lives in the second workgroup. The later
    // absent point shares its position and would otherwise win.
    positions.set([0, 0, 1, 0, 0, 0, 0, 1], 65 * 4)
    const points = scope.own(upload(device, positions))
    const view = scope.own(upload(device, new Float32Array([-40, -40, 80, 0])))
    const picker = scope.own(await createResidentPicker(device, count))
    expect(picker.bytes).toBe(40)
    const pick = (x: number, y: number, ratio = 1): Promise<number | null> => picker.pick(points, view, x, y, 176, 88, ratio)

    // Fit maps one world unit to one device pixel. The samples avoid ties
    // on triangle rasterization edges, whose ownership needs a separate check.
    await expect(pick(80, 44)).resolves.toBe(0)
    await expect(pick(64, 28)).resolves.toBe(5)
    await expect(pick(88, 44)).resolves.toBe(65)
    await expect(pick(40, 40)).resolves.toBeNull()
    await expect(pick(176, 44)).resolves.toBeNull()
    await expect(pick(114, 47, 2)).resolves.toBe(3)
    await expect(pick(124, 47, 2)).resolves.toBeNull()
    await expect(pick(122, 47, 2)).resolves.toBe(4)
    await expect(pick(122, 47)).resolves.toBeNull()

    const pending = pick(88, 44)
    await expect(pick(80, 44)).rejects.toThrow('Resident pick already in flight')
    await expect(pending).resolves.toBe(65)
    points.write(new Float32Array([0, 0, 1, 1]), 65 * 16)
    await expect(pick(88, 44)).resolves.toBe(2)

    // This pan and zoom puts the same point at a different pixel.
    view.write(new Float32Array([-24, -18, 40, 0]))
    await expect(pick(112, 48)).resolves.toBe(1)
    await expect(pick(96, 44)).resolves.toBeNull()
    picker.destroy()
    await expect(pick(112, 48)).rejects.toThrow('Resident picker unavailable')
    expect(errors).toEqual([])
  } finally {
    try { scope.destroy() } finally { device.destroy() }
  }
})
