import { expect, it } from 'vitest'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import { DEFAULTS, fixture, point } from './data'
import { compareSnapshotsAsync } from './reference'
import { effectsCpuColors } from './effects-reference'
import { effectScenario, effectsPoints, EFFECTS_FIXTURES, EFFECTS_PROFILES } from './effects-fixtures'
import { pick } from './backend'

it('matches ring/greyout colors and accepts the overlap, image and size-limit masks', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const failures = []
    // The exact polygon-tie fixture is retained as a rejected diagnostic in the
    // full sweep. This regression checks the three scenes with accepted masks.
    for (const name of EFFECTS_FIXTURES.filter(name => name !== 'shapes')) {
      for (const [index, profile] of EFFECTS_PROFILES.entries()) {
        const { points, settings } = effectScenario(name, index)
        const a = await gl.render(points, settings, false, 'eligibility', false)
        const b = await gpu.render(points, settings, false, 'eligibility', false)
        const comparison = await compareSnapshotsAsync(a, b, points, settings)
        const colors = { webgl: effectsCpuColors(a, points, settings), webgpu: effectsCpuColors(b, points, settings) }
        if (!comparison.valid || colors.webgl.budgetFailures || colors.webgpu.budgetFailures) {
          failures.push({ name, profile: profile.name, comparison, colors })
        }
      }
    }
    expect(failures, JSON.stringify(failures)).toEqual([])
  } finally { gpu?.destroy(); gl.destroy() }
}, 180000)

it('keeps decorative rings out of picking and applies greyout opacity instead of global opacity', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    for (const backend of [gl, gpu]) {
      const points = [point(180.5, 160.5, 0, { size: 40, outlined: true }),
        point(300.5, 160.5, 0, { size: 40, outlined: true, greyed: true })]
      const settings = { ...DEFAULTS, highlighting: true, opacity: 0, greyoutOpacity: 0.35, hovered: [0, 0, 1], focused: 1 }
      const base = await backend.render(points, { ...settings, hovered: [], focused: undefined }, false, 'eligibility', false)
      const decorated = await backend.render(points, settings, false, 'eligibility', false)
      expect(decorated.ids).toEqual(base.ids)
      expect(pick(decorated, 180, 160)).toBeNull(); expect(pick(decorated, 300, 160)).toBe(1)
      // Closed circle ties, including a 3-4-5 radius, must not depend on ring padding.
      for (const [dx, dy] of [[0, -20], [0, 20], [-20, 0], [20, 0], [12, 16], [-12, -16]]) {
        expect(pick(decorated, 300 + dx, 160 + dy)).toBe(1)
      }
      const deduplicated = await backend.render(points, { ...settings, hovered: [0, 1] }, false, 'eligibility', false)
      expect(decorated.color).toEqual(deduplicated.color)
      expect(base.color.some(v => v > 0)).toBe(true)
      const production = await backend.render(fixture('shapes'), DEFAULTS, false, 'production', false)
      await backend.render(effectsPoints('overlap'), { ...DEFAULTS, highlighting: true, hovered: [0], focused: 1 }, false, 'eligibility', false)
      const restored = await backend.render(fixture('shapes'), DEFAULTS, false, 'production', false)
      expect(restored.color).toEqual(production.color); expect(restored.ids).toEqual(production.ids)
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
