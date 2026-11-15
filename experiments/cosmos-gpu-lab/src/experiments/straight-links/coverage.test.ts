import { expect, it } from 'vitest'
import { pick } from '../../gpu/rgba-readback'
import { createLinksWebGL } from './webgl'
import { createLinksWebGPU } from './webgpu'
import { DEFAULTS, fixture } from './data'
import { replayHardCoverage, type HardRow } from './hard-coverage'
import { compare } from './reference'
it('captures hard-edge interpolation and pixel-distance values without changing ordinary images', async () => {
  const gl = await createLinksWebGL(document.createElement('canvas')); let gpu: Awaited<ReturnType<typeof createLinksWebGPU>> | undefined
  try {
    gpu = await createLinksWebGPU(document.createElement('canvas'))
    const rows: HardRow[] = []
    await replayHardCoverage({ webgl: gl, webgpu: gpu }, row => { rows.push(row) }, () => false)
    expect(rows).toHaveLength(9)
    for (const row of rows) {
      expect(row.comparison.invisible).toEqual({ webgl: 0, webgpu: 0 })
      expect(row.preservation.webgl.changedPixels).toBe(0)
      expect(row.samples.webgl.consistent).toBe(true); expect(row.samples.webgpu.consistent).toBe(true)
      for (const sample of Object.values(row.samples)) {
        expect(sample.varying[3]).toBe(row.link + 1); expect(sample.pixel[3]).toBe(row.link + 1)
      }
      if (row.method === 'native') expect(row.preservation.webgpu.changedPixels).toBe(0)
      if (row.method === 'pixel') {
        expect(row.comparison.masks.webgpu).toBe(0); expect(row.comparison.cpuColors.webgpu.budgetFailures).toBe(0)
      }
    }
    // Neither diagnostic readback nor an arithmetic experiment may mutate the
    // retained production port or ordinary visible pipeline.
    const scene = fixture('ribbons'); const settings = { ...DEFAULTS, blend: false }
    for (const backend of [gl, gpu]) {
      const original = await backend.render(scene, settings, 'production', false)
      const before = await backend.render(scene, settings, 'visible', false)
      await backend.render(scene, { ...settings, hardCoverage: 'pixel' }, 'visible', false, true)
      const diagnosed = await backend.render(scene, settings, 'visible', false, true)
      expect(diagnosed.color).toEqual(before.color); expect(diagnosed.ids).toEqual(before.ids)
      const restored = await backend.render(scene, { ...settings, hardCoverage: 'pixel' }, 'production', false)
      expect(restored.color).toEqual(original.color); expect(restored.ids).toEqual(original.ids)
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)

it('tests pixel-distance hard edges on both sides of a tie with unchanged CPU gates', async () => {
  const gl = await createLinksWebGL(document.createElement('canvas')); let gpu: Awaited<ReturnType<typeof createLinksWebGPU>> | undefined
  try {
    gpu = await createLinksWebGPU(document.createElement('canvas'))
    const input = fixture('ribbons'); const settings = { ...DEFAULTS, blend: false, hardCoverage: 'pixel' as const }
    for (const shift of [-1 / 1024, 1 / 1024]) {
      const scene = {
        points: input.points.map((p, i) => i === 2 || i === 3 ? { ...p, y: p.y + shift } : p),
        links: input.links.map((l, i) => i === 1 ? l : { ...l, width: 0 }),
      }
      const a = await gl.render(scene, settings, 'visible', false); const b = await gpu.render(scene, settings, 'visible', false)
      expect(pick(b, 100, 96)).toBe(shift > 0 ? 1 : null)
      const result = await compare(a, b, scene, settings)
      // The retained GL color can still disagree near a subpixel edge. This
      // verifies the diagnostic GPU against every CPU pixel, not acceptance
      // of the GL/GPU pair or a waiver of its rejected color gate.
      expect(result, JSON.stringify({ shift, result })).toMatchObject({
        masks: { webgpu: 0 }, invisible: { webgpu: 0 }, cpuColors: { webgpu: { budgetFailures: 0 } },
      })
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
