import { Buffer, luma } from '@luma.gl/core'
import { webgpuAdapter } from '@luma.gl/core/webgpu'
import { RenderKernel } from '@luma.gl/graph'
import { expect, it, vi } from 'vitest'
import { createDefaultConfig } from '../../../src/config'
import { GraphData, PointShape } from '../../../src/modules/GraphData'
import { GraphRenderer, type GraphView } from '../src/renderer'

it('picks the original foreground IDs from a compact list, including scattered, coincident and moving candidates', async () => {
  const errors: string[] = []
  const device = await luma.createDevice({
    type: 'webgpu',
    adapters: [webgpuAdapter],
    waitForPageLoad: false,
    onError: error => { errors.push(error.message); return true },
  })
  const config = createDefaultConfig()
  Object.assign(config, { curvedLinks: false, linkDefaultArrows: false, pointDefaultSize: 12, linkDefaultWidth: 6 })
  // Exercise a partial final workgroup, all 32 mask bits and multiple prefix-scan chunks.
  const count = 65537
  const last = count - 1
  const order = [last, 65505, 127, 32, 31]
  const positions = new Float32Array(count * 4)
  const xy = new Float32Array(count * 2)
  function place (id: number, x: number, y: number): void {
    positions.set([x, y, 0, 0], 4 * id)
    xy.set([x, y], 2 * id)
  }
  for (let i = 0; i < count; i++) place(i, -500, -500)
  for (const id of order) place(id, 42, 70)
  place(0, 16, 22)
  place(1, 230, 22)
  place(2, 190, 40)
  place(3, 110, 22)
  place(4, 77, 22)
  place(5, 104, 118)
  place(6, 253, 112)
  const links = new Float32Array(count * 2)
  for (const id of order) links.set([0, 1], 2 * id)
  const data = new GraphData(config)
  data.inputPointPositions = xy
  data.inputLinks = links
  data.inputPointRenderOrder = order
  data.inputPointSizes = new Float32Array(count).fill(12)
  data.inputPointSizes[2] = 96
  data.inputPointSizes[3] = 0
  data.inputPointColors = new Float32Array(count * 4)
  data.inputPointShapes = new Float32Array(count).fill(PointShape.None)
  data.inputImageData = [new ImageData(1, 1)]
  data.inputPointImageIndices = new Float32Array(count).fill(-1)
  data.inputPointImageIndices[5] = 0
  data.inputPointImageSizes = new Float32Array(count)
  data.inputPointImageSizes[5] = 32
  positions[4 * 4 + 3] = 1 // An absent point centered directly on the visible link.
  data.update()
  const live = device.createBuffer({ data: positions, usage: Buffer.STORAGE | Buffer.COPY_DST })
  const renderer = new GraphRenderer(device, data, config, () => ({ buffer: live, pointCount: count }))
  const indirect = vi.spyOn(RenderKernel.prototype, 'drawIndirect')
  const view: GraphView = { width: 256, height: 128, x: 0, y: 128, scale: 1, pixelRatio: 2 }
  const projected: GraphView = { ...view, pointProjection: { origin: [0, 0], transform: [1, 1, -1, -1] } }
  // Both equivalent cameras go through the real rasterizer; the unprojected
  // external host view keeps its direct draw as an independent reference.
  async function check (x: number, y: number, expected: { kind: 'point' | 'link'; index: number } | null): Promise<void> {
    expect(await renderer.pick(x, 128 - y, view)).toEqual(expected)
    expect(await renderer.pick(x, 128 - y, projected)).toEqual(expected)
  }
  try {
    renderer.update()
    await check(42, 70, { kind: 'point', index: 31 })
    await check(110, 22, { kind: 'link', index: last })
    await check(234, 40, { kind: 'point', index: 2 })
    await check(105, 85, null)
    await check(77, 22, { kind: 'link', index: last })
    // Pointer sprites include unpainted shapes and transparent image texels.
    await check(116, 118, { kind: 'point', index: 5 })
    await check(255, 113, { kind: 'point', index: 6 })
    expect(indirect).toHaveBeenCalledTimes(14)

    // A caller can update the borrowed live buffer without sending Cosmos an invalidation.
    live.write(Float32Array.of(86, 85, 0, 0), 31 * 16)
    await check(42, 70, { kind: 'point', index: 32 })
    await check(86, 85, { kind: 'point', index: 31 })
    // Every live instance is now a candidate. A later custom-order entry still wins.
    for (let i = 0; i < count; i++) place(i, 58, 68)
    live.write(positions)
    await check(58, 68, { kind: 'point', index: 31 })
    indirect.mockClear()
    config.curvedLinks = true
    await check(58, 68, { kind: 'point', index: 31 })
    expect(indirect).not.toHaveBeenCalled()
    expect(errors).toEqual([])
  } finally {
    indirect.mockRestore()
    renderer.destroy()
    live.destroy()
    device.destroy()
  }
})
