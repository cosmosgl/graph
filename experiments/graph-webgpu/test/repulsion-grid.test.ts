import { luma } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { expect, it } from 'vitest'
import { createRepulsionGrid } from '../src/modules/ForceManyBody/repulsion-grid'
import { upload } from '../src/modules/Shared/compute'
import { resourceScope } from '../src/modules/Shared/resource-scope'

it('refines the correct far cells for each quality and leaves adjacent finest cells to near-field repulsion', async () => {
  const scope = resourceScope()
  try {
    const device = scope.own(await luma.createDevice({ type: 'webgpu', adapters: [webgpuAdapter], waitForPageLoad: false }))
    // Three levels at widths 8, 16, 32. The unshifted 28-unit bounds grow to
    // 32, giving cell widths 4, 2, 1 and a probe at x=1.5 near the left edge.
    const count = 200
    const grid = scope.own(createRepulsionGrid(device, count))
    const data = new Float32Array(count * 4)
    for (let i = 0; i < count; i++) data[4 * i + 3] = 1
    const xs = [1.5, 2.25, 3.25, 8.25, 11.25, 20.5]
    for (const [i, x] of xs.entries()) data.set([x, 1.5, 0, 0], 4 * i)
    const positions = scope.own(upload(device, data))
    const bounds = scope.own(upload(device, new Float32Array([0, 0, 28, 28])))
    const forces = scope.own(upload(device, new Float32Array(count * 4)))
    for (const precise of [false, true]) {
      const encoder = scope.own(device.createCommandEncoder())
      const pass = encoder.beginComputePass({})
      try {
        grid.encode(pass, positions, bounds, 1, 1, 0, 0, precise, forces, 0.25, 2)
      } finally { pass.end() }
      device.submit(encoder.finish())
      const bytes = await forces.readAsync(0, 16)
      const [fx, fy] = new Float32Array(bytes.buffer, bytes.byteOffset, 4)
      // x=2.25 belongs to the near pass. At x=8.25 and 11.25, fast uses
      // their common coarse centroid and precise visits their distinct cells.
      const between = precise ? 1 / (8.25 - 1.5) + 1 / (11.25 - 1.5) : 2 / (9.75 - 1.5)
      expect(fx).toBeCloseTo(-(1 / (3.25 - 1.5) + between + 1 / (20.5 - 1.5)), 6)
      expect(fy).toBeCloseTo(0, 6)
    }
  } finally { scope.destroy() }
})
