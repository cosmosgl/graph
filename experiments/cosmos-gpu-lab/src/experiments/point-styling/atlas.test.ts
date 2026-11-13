import { expect, it } from 'vitest'
import { createAtlasDataFromImageData } from '../../../../../src/modules/Points/atlas-utils'
import { ATLAS_BYTES, ATLAS_COORDS, ATLAS_SIZE, sampleAtlas } from './atlas'
import { DEFAULTS, fixture } from './data'
import { atlasCpuColors, compareColors, compareSnapshotsAsync, referencePick } from './reference'
import { contributionPasses, inspectForeground } from './tiny-alpha'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

it('uses the production atlas layout and distinguishes image holes from the same point’s shape', () => {
  const images = Array.from({ length: 4 }, (_, tile) => {
    const bytes = new Uint8ClampedArray(32 * 32 * 4)
    for (let y = 0; y < 32; y++) {
      const offset = ((Math.floor(tile / 2) * 32 + y) * ATLAS_SIZE + (tile % 2) * 32) * 4
      bytes.set(ATLAS_BYTES.subarray(offset, offset + 32 * 4), y * 32 * 4)
    }
    return new ImageData(bytes, 32, 32)
  })
  const packed = createAtlasDataFromImageData(images)!
  expect(packed.atlasData).toEqual(ATLAS_BYTES); expect(packed.atlasCoords).toEqual(ATLAS_COORDS)
  expect(packed.atlasSize).toBe(64)
  expect(sampleAtlas(0, 0.375, 0.5, 'nearest')[3]).toBe(0)
  expect(sampleAtlas(0, 1, 0.5, 'nearest')[3]).toBe(1)
  expect(sampleAtlas(0, 1, 0.5, 'linear')[3]).toBe(0.5)
  const overlap = fixture('atlas-overlap')
  expect(referencePick(overlap, DEFAULTS, 244.5, 160.5, 'legacy')).toBe(1)
  expect(referencePick(overlap, DEFAULTS, 244.5, 160.5, 'source-alpha')).toBe(0)
  expect(referencePick(fixture('atlas-shapes'), DEFAULTS, 184.5, 160.5, 'source-alpha')).toBe(0)
})

it('matches full-frame CPU masks and sampled CPU colors for the core atlas fixtures', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    for (const name of ['atlas-images', 'atlas-shapes', 'atlas-overlap'] as const) {
      for (const imageFilter of ['nearest', 'linear'] as const) {
        for (const ratio of [1, 2]) {
          const points = fixture(name); const settings = { ...DEFAULTS, imageFilter, ratio }
          const pair = {
            webgl: await gl.render(points, settings, false, 'eligibility', false),
            webgpu: await gpu.render(points, settings, false, 'eligibility', false),
          }
          expect(await compareSnapshotsAsync(pair.webgl, pair.webgpu, points, settings), `${name} ${imageFilter} ${ratio}`)
            .toMatchObject({ valid: true })
          for (const [backend, lane] of [[gl, 'webgl'], [gpu, 'webgpu']] as const) {
            expect(atlasCpuColors(pair[lane], points, settings), `CPU colors ${name} ${imageFilter} ${ratio} ${lane}`)
              .toMatchObject({ budgetFailures: 0 })
            const baseline = await backend.render(points, settings, false, 'explicit', false)
            expect(compareColors(baseline, pair[lane]).changedPixels).toBe(0)
          }
        }
      }
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)

it('rejects invisible foreground texels and restores shape-only images after atlas draws', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const before = {
      webgl: await gl.render(fixture('shapes'), DEFAULTS, false, 'eligibility', false),
      webgpu: await gpu.render(fixture('shapes'), DEFAULTS, false, 'eligibility', false),
    }
    const points = fixture('atlas-overlap')
    const pair = {
      webgl: await gl.render(points, DEFAULTS, false, 'eligibility', false),
      webgpu: await gpu.render(points, DEFAULTS, false, 'eligibility', false),
    }
    const audit = await inspectForeground({ webgl: gl, webgpu: gpu }, pair, points, DEFAULTS, 'eligibility')
    expect(contributionPasses(audit)).toBe(true)
    for (const [backend, lane] of [[gl, 'webgl'], [gpu, 'webgpu']] as const) {
      const hidden = await backend.render(points, { ...DEFAULTS, opacity: 0 }, false, 'eligibility', false)
      expect(hidden.color.every(x => x === 0)).toBe(true); expect(hidden.ids.every(x => x === 0)).toBe(true)
      const after = await backend.render(fixture('shapes'), DEFAULTS, false, 'eligibility', false)
      expect(after.color).toEqual(before[lane].color); expect(after.ids).toEqual(before[lane].ids)
    }
  } finally { gpu?.destroy(); gl.destroy() }
})
