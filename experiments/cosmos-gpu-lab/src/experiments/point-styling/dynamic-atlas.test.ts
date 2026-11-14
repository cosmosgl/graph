import { expect, it } from 'vitest'
import { createAtlasDataFromImageData } from '../../../../../src/modules/Points/atlas-utils'
import { DEFAULTS } from './data'
import { compareColors, compareSnapshotsAsync, atlasCpuColors } from './reference'
import { packDynamicImages } from './dynamic-atlas'
import { applyDynamicStep, DYNAMIC_STEPS, dynamicPoints } from './dynamic-study'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import { pick } from './backend'

it('matches production repacking and owns the input bytes', () => {
  for (const step of DYNAMIC_STEPS) {
    if (step.operation !== 'replace') continue
    const layout = packDynamicImages(step.images)
    if (!step.images.length) {
      expect(layout).toMatchObject({ width: 1, height: 1, images: [] }); expect(layout.coords.every(v => v === -1)).toBe(true); continue
    }
    const control = createAtlasDataFromImageData(step.images.map(image => new ImageData(new Uint8ClampedArray(image.bytes), image.width, image.height)))!
    expect(layout.bytes).toEqual(control.atlasData); expect(layout.coords).toEqual(control.atlasCoords)
    expect(layout.width).toBe(control.atlasSize); expect(layout.coordsSize).toBe(control.atlasCoordsSize)
  }
  const source = { width: 1, height: 1, bytes: new Uint8Array(4) }; const layout = packDynamicImages([source])
  source.bytes[0] = 255; expect(layout.images[0].bytes[0]).toBe(0); expect(layout.bytes[0]).toBe(0)
})

it('updates live texture regions, repacks, removes images and restores the static control', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const points = dynamicPoints(); const settings = { ...DEFAULTS, atlasPacking: 'npot-square' as const, atlasIsolation: 'texel' as const }
    for (const backend of [gl, gpu]) {
      const control = await backend.render(points, settings, false, 'production', false)
      applyDynamicStep(backend.atlas, 0)
      const texture = backend.atlas.texture('nearest'); const linear = backend.atlas.texture('linear')
      const original = await backend.render(points, settings, false, 'eligibility', false)
      const previousBytes = original.atlasSource!.bytes.slice()
      expect(pick(original, 130, 200)).toBe(1); expect(pick(original, 111, 200)).toBe(0); expect(pick(original, 390, 80)).toBeNull()
      const upload = applyDynamicStep(backend.atlas, 1)
      expect(upload).toMatchObject({ allocatedTextures: 0, releasedTextures: 0, liveTextures: 2 })
      expect(backend.atlas.texture('nearest')).toBe(texture); expect(backend.atlas.texture('linear')).toBe(linear)
      expect(original.atlasSource!.bytes).toEqual(previousBytes)
      const filled = await backend.render(points, settings, false, 'eligibility', false)
      expect(pick(filled, 111, 200)).toBe(1)
      applyDynamicStep(backend.atlas, 2)
      for (const imageFilter of ['nearest', 'linear'] as const) {
        const blank = await backend.render(points, { ...settings, imageFilter }, false, 'eligibility', false)
        expect(pick(blank, 130, 200)).toBe(0); expect(atlasCpuColors(blank, points, { ...settings, imageFilter }).budgetFailures).toBe(0)
      }
      applyDynamicStep(backend.atlas, 3)
      const narrow = await backend.render(points, settings, false, 'eligibility', false)
      expect(narrow.color[(80 * narrow.width + 260) * 4 + 3]).toBe(255)
      const grown = applyDynamicStep(backend.atlas, 4)
      expect(grown).toMatchObject({ width: 111, images: 6, allocatedTextures: 2, releasedTextures: 2, liveTextures: 2 })
      expect(texture.destroyed).toBe(true); expect(linear.destroyed).toBe(true)
      const replaced = await backend.render(points, settings, false, 'eligibility', false)
      expect(pick(replaced, 390, 80)).toBe(6)
      applyDynamicStep(backend.atlas, 5)
      const shrunk = await backend.render(points, settings, false, 'eligibility', false)
      expect(pick(shrunk, 390, 80)).toBeNull(); expect(shrunk.atlasSource).toMatchObject({ width: 38, coordsSize: 2 })
      applyDynamicStep(backend.atlas, 6)
      const empty = await backend.render(points, settings, false, 'eligibility', false)
      expect(pick(empty, 130, 200)).toBe(0); expect(pick(empty, 260, 200)).toBe(2)
      expect(empty.atlasSource!.images).toHaveLength(0)
      applyDynamicStep(backend.atlas, 7)
      const restoredDynamic = await backend.render(points, settings, false, 'eligibility', false)
      expect(restoredDynamic.color).toEqual(original.color); expect(restoredDynamic.ids).toEqual(original.ids)
      expect(applyDynamicStep(backend.atlas, 8)).toMatchObject({ liveTextures: 0, allocatedTextures: 0, releasedTextures: 2 })
      const restoredControl = await backend.render(points, settings, false, 'production', false)
      expect(restoredControl.color).toEqual(control.color); expect(restoredControl.ids).toEqual(control.ids)
    }
  } finally { gpu?.destroy(); gl.destroy() }
}, 180000)

it('compares every generation against its own CPU image and rejects invalid updates without changing it', async () => {
  const gl = await createStylingWebGL(document.createElement('canvas'))
  let gpu: Awaited<ReturnType<typeof createStylingWebGPU>> | undefined
  try {
    gpu = await createStylingWebGPU(document.createElement('canvas'))
    const points = dynamicPoints(); const settings = { ...DEFAULTS, atlasPacking: 'npot-square' as const, atlasIsolation: 'texel' as const }
    for (const [step, DYNAMIC_STEP] of DYNAMIC_STEPS.entries()) {
      applyDynamicStep(gl.atlas, step); applyDynamicStep(gpu.atlas, step)
      const a = await gl.render(points, settings, false, 'eligibility', false)
      const b = await gpu.render(points, settings, false, 'eligibility', false)
      expect(await compareSnapshotsAsync(a, b, points, settings), DYNAMIC_STEP.name).toMatchObject({ valid: true })
      expect(compareColors(a, b).changedPixels).toBe(0)
      expect(atlasCpuColors(a, points, settings).budgetFailures).toBe(0); expect(atlasCpuColors(b, points, settings).budgetFailures).toBe(0)
    }
    applyDynamicStep(gl.atlas, 0); applyDynamicStep(gpu.atlas, 0)
    const before = await gl.render(points, settings, false, 'eligibility', false)
    const generation = gl.atlas.generation; const texture = gl.atlas.texture('nearest')
    expect(() => gl.atlas.updateImage(0, { width: 2, height: 2, bytes: new Uint8Array(16) })).toThrow('replacement')
    expect(() => gl.atlas.updateImage(99, { width: 1, height: 1, bytes: new Uint8Array(4) })).toThrow('index')
    expect(() => gl.atlas.replace([{ width: 1, height: 1, bytes: new Uint8Array(3) }])).toThrow('RGBA8')
    expect(gl.atlas.generation).toBe(generation); expect(gl.atlas.texture('nearest')).toBe(texture)
    const repeated = await gl.render(points, settings, false, 'eligibility', false)
    expect(repeated.color).toEqual(before.color); expect(repeated.ids).toEqual(before.ids)
    applyDynamicStep(gpu.atlas, 1); applyDynamicStep(gpu.atlas, 2)
    const after = await gpu.render(points, settings, false, 'eligibility', false)
    const mixed = await compareSnapshotsAsync(before, after, points, settings)
    expect(mixed.idDisagreements).toBeGreaterThan(0)
    expect(mixed.webglReferenceFailures).toBe(0); expect(mixed.webgpuReferenceFailures).toBe(0)
  } finally { gpu?.destroy(); gl.destroy() }
}, 180000)
