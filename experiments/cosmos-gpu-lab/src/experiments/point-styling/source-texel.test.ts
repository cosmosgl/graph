import { expect, it } from 'vitest'
import { sourceTexelRects } from './atlas'
import { PACKING_NAMES, packingLayout } from './atlas-packing'
import { DEFAULTS, fixture } from './data'
import { pick } from './backend'
import { atlasCpuColors, compareSnapshotsAsync } from './reference'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

it('supplies exact integer source rectangles independently of normalized UV endpoints', () => {
  expect(Array.from(sourceTexelRects())).toEqual([0, 0, 32, 32, 32, 0, 32, 32, 0, 32, 32, 32, 32, 32, 32, 32])
  for (const packing of PACKING_NAMES) {
    expect(Array.from(sourceTexelRects(packing))).toEqual(packingLayout(packing).rects.flatMap(r => [r.x, r.y, r.width, r.height]))
  }
})

it('passes the three nearest-boundary counterexamples and retains both controls', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const points = fixture('atlas-packing-edges')
    for (const atlasPacking of ['npot-square', 'npot-rectangle', 'pot-padded'] as const) {
      const settings = { ...DEFAULTS, atlasPacking, imageFilter: 'nearest' as const, atlasIsolation: 'texel' as const }
      const pair = {
        webgl: await gl.render(points, settings, false, 'eligibility', false),
        webgpu: await gpu.render(points, settings, false, 'eligibility', false),
      }
      expect(await compareSnapshotsAsync(pair.webgl, pair.webgpu, points, settings), atlasPacking).toMatchObject({ valid: true })
      for (const [backend, lane] of [[gl, 'webgl'], [gpu, 'webgpu']] as const) {
        expect(atlasCpuColors(pair[lane], points, settings), `${atlasPacking} ${lane}`).toMatchObject({ budgetFailures: 0 })
        expect(pick(pair[lane], 135, 133)).toBe(1)
        expect(Array.from(pair[lane].color.subarray((133 * pair[lane].width + 135) * 4, (133 * pair[lane].width + 135) * 4 + 4)))
          .toEqual([78, 73, 87, 255])
        const control = await backend.render(points, { ...settings, atlasIsolation: 'clamp' }, false, 'eligibility', false)
        const production = await backend.render(points, settings, false, 'production', false)
        await backend.render(points, settings, false, 'eligibility', false)
        const repeated = await backend.render(points, { ...settings, atlasIsolation: 'clamp' }, false, 'eligibility', false)
        const repeatedProduction = await backend.render(points, { ...settings, atlasIsolation: 'original' }, false, 'production', false)
        expect(repeated.color).toEqual(control.color); expect(repeated.ids).toEqual(control.ids)
        expect(repeatedProduction.color).toEqual(production.color); expect(repeatedProduction.ids).toEqual(production.ids)
        expect(production.atlasIsolation).toBe('original')
      }
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)

it('retains the clamped linear path, opacity-zero rule and shape-only rendering', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    for (const backend of [gl, gpu]) {
      const baseline = await backend.render(fixture('shapes'), DEFAULTS, false, 'eligibility', false)
      for (const atlasPacking of PACKING_NAMES) {
        const points = fixture('atlas-packing-overlap'); const settings = { ...DEFAULTS, atlasPacking, imageFilter: 'linear' as const }
        const control = await backend.render(points, { ...settings, atlasIsolation: 'clamp' }, false, 'eligibility', false)
        const candidate = await backend.render(points, { ...settings, atlasIsolation: 'texel' }, false, 'eligibility', false)
        expect(candidate.color).toEqual(control.color); expect(candidate.ids).toEqual(control.ids)
      }
      const hidden = await backend.render(fixture('atlas-packing-overlap'),
        { ...DEFAULTS, atlasPacking: 'npot-square', atlasIsolation: 'texel', opacity: 0 }, false, 'eligibility', false)
      expect(hidden.color.every(x => x === 0)).toBe(true); expect(hidden.ids.every(x => x === 0)).toBe(true)
      const restored = await backend.render(fixture('shapes'), { ...DEFAULTS, atlasIsolation: 'texel' }, false, 'eligibility', false)
      expect(restored.color).toEqual(baseline.color); expect(restored.ids).toEqual(baseline.ids)
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
