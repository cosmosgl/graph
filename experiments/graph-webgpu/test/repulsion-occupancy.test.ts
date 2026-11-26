import { luma } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { expect, it } from 'vitest'
import { OCCUPANCY_INTERVAL } from '@/graph/modules/ForceManyBody/settings'
import { createOccupancyMeasurement } from '../src/modules/ForceManyBody/occupancy'
import { upload } from '../src/modules/Shared/compute'
import { resourceScope } from '../src/modules/Shared/resource-scope'

it('adapts to dense finest cells and requires two consecutive readings before changing the slot budget', async () => {
  const device = await luma.createDevice({ type: 'webgpu', adapters: [webgpuAdapter], waitForPageLoad: false })
  const scope = resourceScope()
  try {
    const width = 32
    const measure = scope.own(createOccupancyMeasurement(device, width))
    // The coarser levels share the same buffer. Their counts must be excluded.
    const values = new Float32Array((width * width + 1) * 4)
    values[width * width * 4 + 2] = 1000
    values[2] = 8
    const cells = scope.own(upload(device, values))
    async function sample (ticks: number): Promise<void> {
      const pass = device.beginComputePass()
      for (let i = 0; i < ticks; i++) measure.encode(pass, cells)
      pass.end()
      device.submit()
      await measure.collect()
    }

    await sample(1)
    expect(measure.wanted).toBe(8)
    values[2] = 33
    cells.write(values)
    await sample(OCCUPANCY_INTERVAL)
    expect(measure.wanted).toBe(8)
    await sample(OCCUPANCY_INTERVAL)
    expect(measure.wanted).toBe(64)
    measure.reset()
    expect(measure.wanted).toBeUndefined()
    values[2] = 16
    cells.write(values)
    await sample(1)
    expect(measure.wanted).toBe(16)
  } finally { scope.destroy(); device.destroy() }
})
