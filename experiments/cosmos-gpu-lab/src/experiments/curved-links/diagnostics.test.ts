import { expect, it } from 'vitest'
import { pick } from '../../gpu/rgba-readback'
import { DEFAULTS, fixture } from './data'
import { createCurvesWebGL } from './webgl'
import { createCurvesWebGPU } from './webgpu'
import { boundaryWitness, investigateBow } from './boundary'
import { reference, compare } from './reference'
it('captures the isolated default bow without changing ordinary images', async () => {
  const source = fixture('bows'); const scene = { ...source, links: [source.links[1]] }
  const gl = await createCurvesWebGL(document.createElement('canvas')); let gpu: Awaited<ReturnType<typeof createCurvesWebGPU>> | undefined
  try {
    gpu = await createCurvesWebGPU(document.createElement('canvas'))
    for (const backend of [gl, gpu]) {
      const original = await backend.render(scene, DEFAULTS, 'visible', false)
      const captured = await backend.render(scene, DEFAULTS, 'visible', false, true)
      expect(captured.probe?.vertices.length).toBe(40 * 4)
      expect(captured.probe?.varying.length).toBe(512 * 320 * 4)
      expect(captured.color).toEqual(original.color); expect(captured.ids).toEqual(original.ids)
      const restored = await backend.render(scene, DEFAULTS, 'visible', false)
      expect(restored.color).toEqual(original.color); expect(restored.ids).toEqual(original.ids)
      expect(boundaryWitness(captured, DEFAULTS, 352, 85).varying[3]).toBe(1)
      expect(pick(captured, 370, 80)).toBe(0)
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
it('uses the color faces for a separate picking candidate while retaining the folded baseline', async () => {
  const source = fixture('limits'); const scene = { ...source, links: [source.links[3]] }
  const gl = await createCurvesWebGL(document.createElement('canvas')); let gpu: Awaited<ReturnType<typeof createCurvesWebGPU>> | undefined
  try {
    gpu = await createCurvesWebGPU(document.createElement('canvas'))
    for (const ratio of [1, 2]) {
      for (const blend of [true, false]) {
        const settings = { ...DEFAULTS, zoom: 0.5, scaleOnZoom: false, opacity: 0.35, ratio, blend }
        const images = []
        for (const backend of [gl, gpu]) {
          const baseline = await backend.render(scene, settings, 'visible', false)
          const front = await backend.render(scene, settings, 'front', false)
          expect(front.color).toEqual(baseline.color)
          let rejected = 0
          for (let i = 0; i < baseline.ids.length; i += 4) {
            if (baseline.ids[i] && !baseline.color[i + 3]) rejected++
            if (front.ids[i]) expect(front.color[i + 3]).toBeGreaterThan(0)
          }
          expect(rejected).toBeGreaterThan(0); images.push(front)
          const restored = await backend.render(scene, settings, 'visible', false)
          expect(restored.ids).toEqual(baseline.ids); expect(restored.color).toEqual(baseline.color)
        }
        const result = await compare(images[0], images[1], reference(scene, settings))
        expect(result.invisible).toEqual({ webgl: 0, webgpu: 0 })
      }
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
it('replays identical bow vertices through both rasterizers without using them as acceptance masks', async () => {
  const report = await investigateBow()
  expect(report.replays).toHaveLength(9)
  for (const row of report.replays) {
    expect(row.pixel[3]).toBe(1); expect(row.pixel[1]).toBeCloseTo(1 / 9)
    expect(row.carrierDifferences).toBeGreaterThanOrEqual(0)
  }
  for (const row of report.replays.filter(r => r.geometry === `${r.backend} capture`)) {
    expect(row.carrierDifferences).toBe(0); expect(row.cutoffDifferences).toBe(0)
  }
}, 120000)
