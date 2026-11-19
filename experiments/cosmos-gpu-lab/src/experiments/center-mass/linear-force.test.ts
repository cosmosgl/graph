import { Buffer } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { createDevice, readFloats, upload } from '../../gpu/luma'
import { centerReference } from '../combined-layout/center-reference'
import { createCenterWebGPU } from '../combined-layout/center-webgpu'
import { compareArray } from '../many-body/reference'
import { createLinearCenterForce } from './linear-force'

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('linear candidate preserves center force semantics on bounded fixtures', async () => {
  const device = await createDevice('webgpu')
  const points = upload(device, new Float32Array(16))
  const original = device.createBuffer({ byteLength: 64, usage: Buffer.STORAGE | Buffer.COPY_SRC })
  const candidate = device.createBuffer({ byteLength: 64, usage: Buffer.STORAGE | Buffer.COPY_SRC })
  let center: Awaited<ReturnType<typeof createCenterWebGPU>> | undefined
  let linear: Awaited<ReturnType<typeof createLinearCenterForce>> | undefined
  try {
    center = await createCenterWebGPU(device, 4, original)
    linear = await createLinearCenterForce(device, 4, points, candidate, center.resultBuffer())
    for (const fixture of [
      new Float32Array([-8, 0, 1, 0, 8, 0, 0, 0, NaN, NaN, 0, 1, 9000, -9000, 0, 1]),
      new Float32Array([2048, -2048, 1, 0, 2048, -2048, 0, 0, 2048, -2048, 0, 0, 2048, -2048, 0, 0]),
      new Float32Array([1, 2, 0, 1, 2, 3, 0, 1, NaN, NaN, 0, 1, -1, -2, 0, 1]),
      new Float32Array([2100, -2030, 1, 0, 2049, -2098, 0, 0, 2055, -2002, 0, 0, 2023, -2077, 0, 0]),
    ]) {
      for (const [alpha, strength] of [[1, 1], [0.7, 0.4], [0, 1]]) {
        points.write(fixture)
        const first = device.beginComputePass()
        try { center.encode(first, points, alpha, strength) } finally { first.end() }
        device.submit()
        const current = await readFloats(original)
        const second = device.beginComputePass()
        try { linear.encode(second, alpha, strength) } finally { second.end() }
        device.submit()
        const actual = await readFloats(candidate)
        const expected = centerReference(fixture, alpha, strength).forces
        expect(compareArray(actual, expected).valid, JSON.stringify({ fixture: Array.from(fixture), alpha, strength })).toBe(true)
        expect(compareArray(actual, current).valid, JSON.stringify({ fixture: Array.from(fixture), alpha, strength })).toBe(true)
      }
    }
  } finally { linear?.destroy(); center?.destroy(); candidate.destroy(); original.destroy(); points.destroy(); device.destroy() }
}, 120000)

it.skipIf(!import.meta.env.LAB_NATIVE_GPU)('linear candidate passes the existing center stage and integration gates', async () => {
  const { createGraph } = await import('../combined-layout/data')
  const { forceSettings } = await import('../combined-layout/production-settings')
  const { createCombinedWebGPU } = await import('../combined-layout/webgpu')
  for (const count of [4, 4097, 8192]) {
    const { graph, input } = createGraph({ count, fixture: 'chain', decay: 100 })
    for (let i = 0; i < input.points.length; i += 4) { input.points[i] += 2048; input.points[i + 1] -= 2048 }
    input.points[2] = 1
    if (count === 4) input.points.set([NaN, NaN, 0, 1], 4)
    const backend = await createCombinedWebGPU(document.createElement('canvas'), graph, input, 'trig', {
      forceSettings: { ...forceSettings('varied32', count), center: 1 }, centerForceVariant: 'linear',
    })
    try {
      backend.stepStage('center', 1)
      const actual = await backend.read(); const expected = centerReference(input.points, 1, 1)
      const forces = compareArray(actual.forces, expected.forces)
      const positions = compareArray(actual.positions, expected.positions, input.points)
      expect(forces.valid && positions.valid, JSON.stringify({ count, forces, positions })).toBe(true)
    } finally { backend.destroy() }
  }
}, 120000)
