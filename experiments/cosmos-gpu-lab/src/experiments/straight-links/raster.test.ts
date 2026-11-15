import { expect, it } from 'vitest'
import { createLinksWebGL } from './webgl'
import { createLinksWebGPU } from './webgpu'
import { DEFAULTS, fixture } from './data'
import { exactCaps, exactQuad } from './raster-math'
import { replayRaster, RASTER_ROWS, type RasterRow } from './raster-audit'

it('distinguishes exact cap ties and half-open triangles without an epsilon', () => {
  const a: [number, number] = [324, 65]; const b: [number, number] = [460, 201]; const p: [number, number] = [326.5, 62.5]
  expect(exactCaps(a, b, p)).toMatchObject({ start: 0, end: 1, halfOpen: true })
  expect(exactCaps(b, a, p)).toMatchObject({ start: 1, end: 0, halfOpen: true })
  expect(exactCaps(a, b, [p[0] - 1 / 1024, p[1]]).start).toBe(-1)
  expect(exactCaps(a, b, [p[0] + 1 / 1024, p[1]]).start).toBe(1)
  const quad: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1]]
  expect(exactQuad(quad, [0.5, 0])).toBe(true); expect(exactQuad(quad, [0.5, 1])).toBe(false)
  expect(exactQuad(quad, [0, 0.5])).toBe(true); expect(exactQuad(quad, [1, 0.5])).toBe(false)
  expect(() => exactCaps([NaN, 0], b, p)).toThrow()
})

it('captures cap and fractional raster sensitivity while preserving ordinary images and production controls', async () => {
  const gl = await createLinksWebGL(document.createElement('canvas')); let gpu: Awaited<ReturnType<typeof createLinksWebGPU>> | undefined
  try {
    gpu = await createLinksWebGPU(document.createElement('canvas'))
    const rows: RasterRow[] = []
    await replayRaster({ webgl: gl, webgpu: gpu }, row => {
      rows.push(row)
    }, () => false)
    expect(rows).toHaveLength(RASTER_ROWS)
    for (const row of rows) {
      expect(row.preservation.webgl.changedPixels).toBe(0); expect(row.preservation.webgpu.changedPixels).toBe(0)
      expect(row.comparison.invisible).toEqual({ webgl: 0, webgpu: 0 })
      expect(row.geometry.webgl.clip).toHaveLength(4); expect(row.geometry.webgpu.clip).toHaveLength(4)
      expect(row.carrierReplay.webglNativeDifferences).toBe(0); expect(row.carrierReplay.webgpuNativeDifferences).toBe(0)
    }
    const scene = fixture('boundaries')
    for (const backend of [gl, gpu]) {
      const before = await backend.render(scene, DEFAULTS, 'production', false)
      const ordinary = await backend.render(scene, DEFAULTS, 'visible', false)
      const diagnosed = await backend.render(scene, DEFAULTS, 'visible', false, true)
      expect(diagnosed.color).toEqual(ordinary.color); expect(diagnosed.ids).toEqual(ordinary.ids)
      const restored = await backend.render(scene, DEFAULTS, 'production', false)
      expect(restored.color).toEqual(before.color); expect(restored.ids).toEqual(before.ids)
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 180000)
