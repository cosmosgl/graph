import { describe, expect, it } from 'vitest'
import { createDevice } from '../../gpu/luma'
import { DEFAULTS, FIXTURES, PROFILES, fixture } from '../curved-links/data'
import { createCurvesWebGPU } from '../curved-links/webgpu'
import { createRibbonResources } from './backend'
import { changedPixels, makeScene } from './data'
import { runStudy, assessment } from './study'
describe('compute ribbon generation', () => {
  it('preserves every color/ID byte across the existing curve matrix', async () => {
    const errors: string[] = []; const device = await createDevice('webgpu', undefined, true, e => { errors.push(e.message); return true })
    const original = await createCurvesWebGPU(document.createElement('canvas'))
    let checked = 0
    try {
      for (const name of FIXTURES) {
        for (const profile of PROFILES) {
          for (const blend of [true, false]) {
            const settings = { ...DEFAULTS, ...profile.settings, blend }; const scene = fixture(name)
            const resources = createRibbonResources(device, scene, settings)
            try {
              const a = await resources.snapshot('vertex'); const b = await resources.snapshot('rebuild'); const c = await resources.snapshot('reuse')
              const control = await original.render(scene, settings, 'front', false)
              const label = `${name}/${profile.name}/${blend}`
              expect(changedPixels(a.color, control.color), `${label} original color`).toBe(0)
              expect(changedPixels(a.ids, control.ids), `${label} original IDs`).toBe(0)
              expect(changedPixels(a.color, b.color), `${label} cache color`).toBe(0)
              expect(changedPixels(a.ids, b.ids), `${label} cache IDs`).toBe(0)
              expect(changedPixels(b.color, c.color), `${label} reused color`).toBe(0)
              expect(changedPixels(b.ids, c.ids), `${label} reused IDs`).toBe(0)
              checked++
            } finally { resources.destroy() }
          }
        }
      }
      expect(checked).toBe(64); expect(errors).toEqual([])
    } finally { original.destroy(); device.destroy() }
  }, 180000)
  it('charges rebuilding and retains all balanced trial samples', async () => {
    const device = await createDevice('webgpu')
    try {
      const r = await runStudy(device, makeScene(128, 'short'), DEFAULTS, true, () => false, () => {})
      expect(r.validation.colorPixels).toBe(0); expect(r.validation.idPixels).toBe(0); expect(r.validation.visiblePixels).toBeGreaterThan(0)
      expect(r.results.map(row => row.samples.length)).toEqual([8, 8, 8, 8])
      expect(r.sampleBytes).toBe(128 * 20 * 16)
      for (const row of r.results) {
        for (const sample of row.samples) {
          if (sample.gpuMs !== null) expect(sample.gpuMs).toBeCloseTo(sample.computeMs! + sample.renderMs!, 8)
        }
      }
      expect(assessment({ ...r, validation: { ...r.validation, colorPixels: 1 } })).toContain('gate failed')
      // Assessment precedence is independent of the adapter running this test.
      // Even apparently excellent software timings must not imply native gains.
      const software = { ...r, device: { ...r.device, fallback: true } }
      const softwareVerdict = 'Software adapter: execution evidence only; native cost remains unmeasured.'
      expect(assessment(software)).toBe(softwareVerdict)
      expect(assessment({ ...software, results: r.results.map(row => ({ ...row, gpuMs: null })) })).toBe(softwareVerdict)
      expect(assessment({ ...software, results: r.results.map((row, i) => ({ ...row, gpuMs: i < 2 ? 10 : 1, wallMs: i < 2 ? 10 : 1 })) }))
        .toBe(softwareVerdict)
      if (r.device.fallback) expect(assessment(r)).toBe(softwareVerdict)
      expect(assessment({ ...r, device: { ...r.device, fallback: false }, results: r.results.map(row => ({ ...row, gpuMs: null })) }))
        .toBe('GPU timing unavailable or below resolution. No speed conclusion.')
    } finally { device.destroy() }
  })
})
