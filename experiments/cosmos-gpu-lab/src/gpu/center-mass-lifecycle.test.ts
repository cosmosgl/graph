import { afterEach, expect, it, vi } from 'vitest'
import type { Device } from '@luma.gl/core'
import { createWebGPUCenterMass } from '../experiments/center-mass/webgpu/backend'
import { createDevice } from './luma'

vi.mock('./luma', async importOriginal => {
  const original = await importOriginal<typeof import('./luma')>()
  return { ...original, createDevice: vi.fn(original.createDevice) }
})

afterEach(() => { vi.restoreAllMocks(); vi.mocked(createDevice).mockClear() })

it.for(['buffer', 'render pipeline'] as const)('destroys the WebGPU device when %s setup throws', async (stage, context) => {
  const canvas = document.createElement('canvas')
  canvas.width = 64; canvas.height = 64
  let device: Device
  try {
    device = await createDevice('webgpu', canvas)
  } catch (error) {
    if (import.meta.env.REQUIRE_WEBGPU) throw error
    context.skip(); return
  }
  const destroy = vi.spyOn(device, 'destroy')
  const failure = new Error(`Injected ${stage} setup failure`)
  vi.mocked(createDevice).mockResolvedValueOnce(device)
  if (stage === 'buffer') {
    vi.spyOn(device, 'createBuffer').mockImplementationOnce(() => { throw failure })
  } else {
    // Fail after the six buffers and compute kernels have already been created.
    vi.spyOn(device, 'createRenderPipeline').mockImplementationOnce(() => { throw failure })
  }
  try {
    await expect(createWebGPUCenterMass(canvas, 513)).rejects.toBe(failure)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(device.isLost).toBe(true)
  } finally {
    // Also release the device if this regression test fails against a leaking constructor.
    if (!device.isLost) device.destroy()
  }
})
