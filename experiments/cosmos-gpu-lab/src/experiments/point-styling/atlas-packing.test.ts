import { expect, it, vi } from 'vitest'
import { createAtlasDataFromImageData } from '../../../../../src/modules/Points/atlas-utils'
import { PACKING_NAMES, PACKING_SOURCES, packingLayout, samplePacking } from './atlas-packing'
import { DEFAULTS, fixture } from './data'
import { pick } from './backend'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

it('matches the production packer for non-square images and texture-limit resampling', () => {
  const images = PACKING_SOURCES.map(image => new ImageData(new Uint8ClampedArray(image.bytes), image.width, image.height))
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    for (const [name, limit] of [['npot-square', 16384], ['npot-scaled', 62]] as const) {
      const production = createAtlasDataFromImageData(images, limit)!
      const layout = packingLayout(name)
      expect(layout.bytes).toEqual(production.atlasData); expect(layout.coords).toEqual(production.atlasCoords)
      expect(layout.width).toBe(production.atlasSize); expect(layout.height).toBe(production.atlasSize)
      expect(layout.coordsSize).toBe(production.atlasCoordsSize)
      expect(Array.from(layout.coords.subarray(5 * 4))).toEqual(Array(16).fill(-1))
    }
    expect(packingLayout('npot-scaled').images.map(i => [i.width, i.height])).toEqual([[20, 10], [13, 20], [6, 20], [13, 9], [1, 11]])
  } finally { warning.mockRestore() }
})

it('preserves image positions and pixels across rectangular and padded normalization controls', () => {
  const square = packingLayout('npot-square')
  for (const name of ['npot-rectangle', 'pot-padded'] as const) {
    const layout = packingLayout(name)
    expect(layout.rects).toEqual(square.rects); expect(layout.images).toEqual(square.images)
    for (const rect of layout.rects) {
      for (let y = 0; y < rect.height; y++) {
        const read = (data: typeof layout): Uint8Array => data.bytes.subarray(((rect.y + y) * data.width + rect.x) * 4,
          ((rect.y + y) * data.width + rect.x + rect.width) * 4)
        expect(read(layout)).toEqual(read(square))
      }
    }
    expect(layout.coords[3]).toBeCloseTo(17 / layout.height, 7)
  }
  for (const name of PACKING_NAMES) {
    const image = packingLayout(name).images[4]
    expect(image.width).toBe(1)
    for (const filter of ['nearest', 'linear'] as const) {
      expect(samplePacking(name, 4, 0, 0.5, filter, 'clamp')).toEqual(samplePacking(name, 4, 1, 0.5, filter, 'clamp'))
    }
  }
})

it('renders all five image records, retains production UVs and restores the baseline atlas', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const points = fixture('atlas-packing-grid')
    for (const backend of [gl, gpu]) {
      const baseline = await backend.render(fixture('atlas-images'), DEFAULTS, false, 'production', false)
      for (const atlasPacking of PACKING_NAMES) {
        for (const imageFilter of ['nearest', 'linear'] as const) {
          const settings = { ...DEFAULTS, atlasPacking, imageFilter }
          const original = await backend.render(points, settings, false, 'production', false)
          const retained = await backend.render(points, { ...settings, atlasIsolation: 'clamp' }, false, 'production', false)
          expect(retained.atlasIsolation).toBe('original'); expect(retained.atlasPacking).toBe(atlasPacking)
          expect(retained.color).toEqual(original.color); expect(retained.ids).toEqual(original.ids)
          const candidate = await backend.render(points, { ...settings, atlasIsolation: 'clamp' }, false, 'eligibility', false)
          expect(pick(candidate, 448, 160)).toBe(4)
        }
      }
      const restored = await backend.render(fixture('atlas-images'), DEFAULTS, false, 'production', false)
      expect(restored.color).toEqual(baseline.color); expect(restored.ids).toEqual(baseline.ids)
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 120000)
