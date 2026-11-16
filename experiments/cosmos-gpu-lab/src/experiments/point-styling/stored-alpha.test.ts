import { expect, it } from 'vitest'
import { pick, type Backend, type Snapshot } from './backend'
import { storedAlphaReplay } from './stored-alpha-study'
import { alphaBoundarySamples } from './alpha-conversion'
import { DEFAULTS, point, type Point, type Settings } from './data'
import { compareColors, referencePick } from './reference'
import { cropRegion, type PixelRegion } from './stored-alpha'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'

async function check (backend: Backend, points: Point[], settings: Settings, region: PixelRegion): Promise<Snapshot> {
  const original = await backend.render(points, settings, false, 'explicit', false)
  const candidate = await backend.render(points, settings, false, 'explicit', false, { region, audit: true })
  expect(compareColors(original, candidate)).toEqual({ changedPixels: 0, maxChannelError: 0, budgetFailures: 0 })
  const trace = candidate.storedAlpha!
  expect(cropRegion(candidate.ids, candidate.width, region)).toEqual(trace.cpuIds)
  // Independently verify the retained half-coverage geometry, then gate it by
  // measured per-point paint. Do not substitute a predicted alpha byte.
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      const offset = (y * region.width + x) * 4
      let expected: number | null = null
      for (const layer of trace.layers) {
        const geometric = referencePick([points[layer.id]], settings, region.x + x + 0.5, region.y + y + 0.5, 'visible') !== null
        expect(layer.geometry[offset + 3] > 0, `geometry ${layer.id} at ${x},${y}`).toBe(geometric)
        if (geometric && layer.paint[offset + 3] > 0) expected = layer.id
      }
      expect(pick(candidate, region.x + x, region.y + y), `stored ID at ${x},${y}`).toBe(expected)
    }
  }
  // The returned ID image is explicitly region-limited; stale original IDs
  // must not survive outside it, including after a previous nonempty request.
  for (let y = 0; y < candidate.height; y++) {
    for (let x = 0; x < candidate.width; x++) {
      if (x < region.x || x >= region.x + region.width || y < region.y || y >= region.y + region.height) {
        if (candidate.ids[(y * candidate.width + x) * 4 + 3]) throw new Error(`ID escaped region at ${x},${y}`)
      }
    }
  }
  const restored = await backend.render(points, settings, false, 'explicit', false)
  expect(compareColors(restored, original).changedPixels).toBe(0)
  expect(restored.ids.every((value, i) => value === original.ids[i])).toBe(true)
  return candidate
}

for (const [name, create] of [['WebGL', createStylingWebGL], ['WebGPU', createStylingWebGPU]] as const) {
  it(`${name}: uses stored alpha at the first byte boundary without changing original colors`, async ({ task }) => {
    const backend = await create(document.createElement('canvas'))
    try {
      const samples = alphaBoundarySamples()
      for (const alpha of [0, 1 / 65536, ...samples.slice(2, 5), 1]) {
        for (const opacity of [0, 0.35, 1]) {
          const points = [point(56.5, 6.5, 0, { size: 4, color: [0.62, 0.71, 0.84, alpha] })]
          const image = await check(backend, points, { ...DEFAULTS, opacity }, { x: 53, y: 3, width: 8, height: 8 })
          const alphaByte = image.color[(6 * image.width + 56) * 4 + 3]
          expect(pick(image, 56, 6)).toBe(alphaByte > 0 ? 0 : null)
          if (alpha === samples[3] && opacity === 1) {
            task.meta.alphaConversion = { backend: backend.info, alphaByte, id: pick(image, 56, 6), policy: 'stored-alpha-v1' }
            // eslint-disable-next-line no-console
            console.info('Stored boundary', JSON.stringify(task.meta.alphaConversion))
          }
        }
      }
    } finally { backend.destroy() }
  }, 120000)

  it(`${name}: falls through invisible foregrounds and preserves order, images and region coordinates`, async () => {
    const backend = await create(document.createElement('canvas'))
    try {
      const boundary = alphaBoundarySamples()[3]
      for (const ratio of [1, 2]) {
        const region = { x: 248 * ratio, y: 152 * ratio, width: 18 * ratio, height: 18 * ratio }
        for (const reverse of [false, true]) {
          const points = [point(256.5, 160.5, 1, { size: 30, color: [0.2, 0.6, 0.9, 1], greyed: true }),
            point(256.5, 160.5, 0, { size: 8, color: [0.9, 0.3, 0.1, boundary] }),
            point(256.5, 160.5, 0, { size: 12, color: [1, 1, 1, 1 / 65536] })]
          for (const highlighting of [false, true]) {
            const image = await check(backend, points, { ...DEFAULTS, ratio, reverse, highlighting }, region)
            expect(pick(image, 256 * ratio, 160 * ratio)).not.toBe(2)
          }
        }
        await check(backend, [point(256.5, 160.5, 1, { size: 32 }),
          point(256.5, 160.5, 8, { size: 0, image: 0, imageSize: 16, color: [0, 0, 0, 0] })],
        { ...DEFAULTS, ratio, atlasIsolation: 'texel' }, region)
      }
      const r = { x: 53, y: 3, width: 8, height: 8 }
      const faint = [point(56.5, 6.5, 0, { size: 4, color: [1, 1, 1, 1 / 65536] })]
      const onBackground = await check(backend, faint, { ...DEFAULTS, backgroundColor: [1, 1, 1, 1] }, r)
      expect(pick(onBackground, 56, 6)).toBe(null)
      await check(backend, [], DEFAULTS, r)
      const audited = await backend.render(faint, DEFAULTS, false, 'explicit', false, { region: r, audit: true })
      const gpuOnly = await backend.render(faint, DEFAULTS, false, 'explicit', false, { region: r })
      expect(gpuOnly.ids.every((v, i) => v === audited.ids[i])).toBe(true)
      expect(gpuOnly.storedAlpha!.cpuIds).toBeUndefined()
      for (const row of await storedAlphaReplay(backend)) {
        expect(row.changedColors).toBe(0); expect(row.cpuMismatches).toBe(0); expect(row.invisiblePicks).toBe(0)
      }
      await expect(backend.render([point(56.5, 6.5, 0, { outlined: true })], DEFAULTS, false, 'explicit', false, { region: r }))
        .rejects.toThrow('decorative rings')
    } finally { backend.destroy() }
  }, 120000)
}
