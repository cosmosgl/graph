import { expect, it } from 'vitest'
import { ATLAS_BYTES, GUTTER_BYTES, GUTTER_SIZE, sampleAtlas, sampleAtlasPolicy, sampleIsolatedImage } from './atlas'
import { DEFAULTS, fixture } from './data'
import { pick } from './backend'
import { atlasCpuColors, compareColors, compareSnapshotsAsync } from './reference'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

it('isolates a tile without moving its interior sampling coordinates', () => {
  const f = Math.fround
  // At the failed pixel the ideal packed coordinate is 5. Float32 normalized
  // endpoints place it just below 5 for extent 68; extent 128 is exact.
  const coordinate = (size: number): number => f(f(f(1 / size) * f(1 - 0.125)) + f(f(33 / size) * 0.125)) * size
  expect(coordinate(68)).toBeLessThan(5); expect(coordinate(128)).toBe(5)
  for (const filter of ['nearest', 'linear'] as const) {
    expect(sampleAtlas(0, 1, 0.5, filter)[3]).toBeGreaterThan(0)
    expect(sampleIsolatedImage(0, 1, 0.5, filter)[3]).toBe(0)
    // The half-texel remap moves every interior coordinate, even far from edges.
    expect(sampleAtlasPolicy(0, 0.2, 0.4, 'linear', 'inset'))
      .not.toEqual(sampleIsolatedImage(0, 0.2, 0.4, 'linear'))
  }
  // Each packed texel, including corners, must come from its own source image.
  for (let tile = 0; tile < 4; tile++) {
    for (let y = 0; y < 34; y++) {
      for (let x = 0; x < 34; x++) {
        const sourceX = (tile % 2) * 32 + Math.max(0, Math.min(31, x - 1))
        const sourceY = Math.floor(tile / 2) * 32 + Math.max(0, Math.min(31, y - 1))
        const source = (sourceY * 64 + sourceX) * 4
        const target = ((Math.floor(tile / 2) * 34 + y) * GUTTER_SIZE + (tile % 2) * 34 + x) * 4
        expect(GUTTER_BYTES.subarray(target, target + 4)).toEqual(ATLAS_BYTES.subarray(source, source + 4))
      }
    }
  }
})

it('replays the gutter counterexample with unchanged points and power-of-two normalization', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'), 128)
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'), 128)
    const points = fixture('atlas-edges')
    for (const imageFilter of ['nearest', 'linear'] as const) {
      const settings = { ...DEFAULTS, imageFilter, atlasIsolation: 'gutter' as const }
      const pair = {
        webgl: await gl.render(points, settings, false, 'eligibility', false),
        webgpu: await gpu.render(points, settings, false, 'eligibility', false),
      }
      expect(await compareSnapshotsAsync(pair.webgl, pair.webgpu, points, settings)).toMatchObject({ valid: true })
      for (const image of Object.values(pair)) {
        expect(image.atlasGutterExtent).toBe(128)
        expect(atlasCpuColors(image, points, settings)).toMatchObject({ budgetFailures: 0 })
        expect(pick(image, 180, 100)).toBe(0)
        if (imageFilter === 'nearest') {
          expect(Array.from(image.color.subarray((100 * image.width + 180) * 4, (100 * image.width + 180) * 4 + 4)))
            .toEqual([60, 70, 180, 255])
        }
      }
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 60000)

it('matches isolated CPU colors and masks with tile clamps across all atlas fixtures', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    for (const name of ['atlas-images', 'atlas-shapes', 'atlas-overlap', 'atlas-edges'] as const) {
      for (const imageFilter of ['nearest', 'linear'] as const) {
        for (const ratio of [1, 2]) {
          const points = fixture(name); const settings = { ...DEFAULTS, imageFilter, ratio, atlasIsolation: 'clamp' as const }
          const pair = {
            webgl: await gl.render(points, settings, false, 'eligibility', false),
            webgpu: await gpu.render(points, settings, false, 'eligibility', false),
          }
          expect(await compareSnapshotsAsync(pair.webgl, pair.webgpu, points, settings), `${name} ${imageFilter} ${ratio}`)
            .toMatchObject({ valid: true })
          for (const [backend, lane] of [[gl, 'webgl'], [gpu, 'webgpu']] as const) {
            expect(atlasCpuColors(pair[lane], points, settings), `${name} ${imageFilter} ${ratio} ${lane}`).toMatchObject({ budgetFailures: 0 })
            const baseline = await backend.render(points, settings, false, 'explicit', false)
            expect(compareColors(baseline, pair[lane]).changedPixels).toBe(0)
          }
        }
      }
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)

it('retains the production control and removes the known neighbor-alpha edge sample', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const points = fixture('atlas-edges')
    for (const backend of [gl, gpu]) {
      for (const imageFilter of ['nearest', 'linear'] as const) {
        const settings = { ...DEFAULTS, imageFilter }
        const production = await backend.render(points, settings, false, 'production', false)
        const original = await backend.render(points, settings, false, 'eligibility', false)
        expect(original.color[(112 * original.width + 208) * 4 + 3]).toBeGreaterThan(0)
        expect(pick(original, 208, 112)).toBe(0)
        for (const atlasIsolation of ['clamp', 'inset', 'gutter'] as const) {
          const candidate = await backend.render(points, { ...settings, atlasIsolation }, false, 'eligibility', false)
          expect(candidate.color[(112 * candidate.width + 208) * 4 + 3]).toBe(0)
          expect(pick(candidate, 208, 112)).toBeNull()
          const control = await backend.render(points, { ...settings, atlasIsolation }, false, 'production', false)
          expect(control.atlasIsolation).toBe('original')
          expect(control.color).toEqual(production.color); expect(control.ids).toEqual(production.ids)
        }
      }
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 60000)
