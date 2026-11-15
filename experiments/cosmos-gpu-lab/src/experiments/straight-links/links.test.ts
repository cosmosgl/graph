import { expect, it } from 'vitest'
import { pick } from '../../gpu/rgba-readback'
import { createLinksWebGL } from './webgl'
import { createLinksWebGPU } from './webgpu'
import { DEFAULTS, fixture, type Scene } from './data'
import { compare, compareColors } from './reference'
import { contributions } from './study'
import type { Backend } from './backend'

async function withBackends (run: (backends: { webgl: Backend; webgpu: Backend }) => Promise<void>): Promise<void> {
  const webgl = await createLinksWebGL(document.createElement('canvas'))
  let webgpu: Backend | undefined
  try { webgpu = await createLinksWebGPU(document.createElement('canvas')); await run({ webgl, webgpu }) } finally {
    webgpu?.destroy(); webgl.destroy()
  }
}

it('accepts straight production ribbon colors with visible-footprint IDs and retains the padded control', async () => {
  await withBackends(async backends => {
    const scene = fixture('ribbons')
    const a = await backends.webgl.render(scene, DEFAULTS, 'production')
    const b = await backends.webgpu.render(scene, DEFAULTS, 'production')
    const c = await backends.webgl.render(scene, DEFAULTS, 'visible')
    const d = await backends.webgpu.render(scene, DEFAULTS, 'visible')
    const production = await compare(a, b, scene, DEFAULTS); const candidate = await compare(c, d, scene, DEFAULTS)
    expect(compareColors(a.color, c.color).changedPixels).toBe(0); expect(compareColors(b.color, d.color).changedPixels).toBe(0)
    expect(production.invisible.webgl).toBeGreaterThan(0); expect(production.invisible.webgpu).toBeGreaterThan(0)
    expect(candidate, JSON.stringify(candidate)).toMatchObject({
      idDifferences: 0, masks: { webgl: 0, webgpu: 0 }, invisible: { webgl: 0, webgpu: 0 }, passed: true,
    })
    for (const image of [a, b]) {
      expect(pick(image, 100, 45)).toBe(0); expect(image.color[(45 * image.width + 100) * 4 + 3]).toBe(0)
    }
    for (const image of [c, d]) { expect(pick(image, 100, 45)).toBeNull(); expect(pick(image, 100, 48)).toBe(0) }
  })
}, 120000)

it('rejects an invisible foreground source over an opaque link without changing original blending', async () => {
  await withBackends(async backends => {
    const scene = fixture('overlap'); const pair = {} as Parameters<typeof contributions>[1]
    for (const lane of ['webgl', 'webgpu'] as const) {
      const before = await backends[lane].render(scene, DEFAULTS, 'production', false)
      pair[lane] = await backends[lane].render(scene, DEFAULTS, 'visible', false)
      expect(pick(before, 150, 160)).toBe(3); expect(pick(pair[lane], 150, 160)).toBe(0)
      expect(pair[lane].color).toEqual(before.color)
    }
    expect(await contributions(backends, pair, scene, DEFAULTS, 'visible')).toEqual({ webgl: 0, webgpu: 0, sources: [3] })
    const reverse = { ...DEFAULTS, reverse: true, indexOffset: 65535 }
    for (const backend of Object.values(backends)) {
      const image = await backend.render(scene, reverse, 'visible', false)
      expect(pick(image, 150, 160)).toBe(65535); expect(pick(image, 256, 100)).toBe(65536)
    }
  })
}, 120000)

it('retains width defaults, absence and zero opacity across hard/blended, DPR and policy switches', async () => {
  await withBackends(async backends => {
    const scene = fixture('limits')
    for (const backend of Object.values(backends)) {
      const control = await backend.render(scene, DEFAULTS, 'production', false)
      const normal = await backend.render(scene, DEFAULTS, 'visible', false)
      expect(pick(normal, 100, 35)).toBeNull(); expect(pick(normal, 100, 188)).toBe(4)
      expect(pick(normal, 350, 115)).toBe(6); expect(pick(normal, 350, 195)).toBeNull()
      expect(pick(normal, 380, 270)).toBeNull()
      const defaults = { ...scene, links: scene.links.map((link, i) => i === 3 ? link : { ...link, width: 0 }) }
      expect(pick(await backend.render(defaults, DEFAULTS, 'visible', false), 100, 188)).toBe(3)
      const hidden = await backend.render(scene, { ...DEFAULTS, opacity: 0 }, 'visible', false)
      expect(hidden.color.some(v => v !== 0)).toBe(false); expect(hidden.ids.some(v => v !== 0)).toBe(false)
      const hard = { ...DEFAULTS, blend: false, ratio: 2 }
      const solid = await backend.render(scene, hard, 'visible', false)
      const translucent = await backend.render(scene, { ...hard, opacity: 0.35 }, 'visible', false)
      expect(solid.color).toEqual(translucent.color); expect(solid.ids).toEqual(translucent.ids)
      const restored = await backend.render(scene, DEFAULTS, 'production', false)
      expect(restored.color).toEqual(control.color); expect(restored.ids).toEqual(control.ids)
    }
    const empty: Scene = { points: [], links: [] }
    for (const backend of Object.values(backends)) {
      const image = await backend.render(empty, DEFAULTS, 'visible', false)
      expect(image.color.some(v => v !== 0)).toBe(false); expect(image.ids.some(v => v !== 0)).toBe(false)
    }
  })
}, 120000)

it('never lets an analytic hard-edge ID select a discarded color fragment', async () => {
  await withBackends(async backends => {
    for (const [name, settings] of [
      ['ribbons', { ...DEFAULTS, blend: false }],
      ['limits', { ...DEFAULTS, blend: false, zoom: 0.5, reverse: true, opacity: 0.35 }],
      ['boundaries', { ...DEFAULTS, blend: false }],
    ] as const) {
      const scene = fixture(name)
      const a = await backends.webgl.render(scene, settings, 'visible', false)
      const b = await backends.webgpu.render(scene, settings, 'visible', false)
      const result = await compare(a, b, scene, settings)
      expect(result.invisible).toEqual({ webgl: 0, webgpu: 0 })
      expect(await contributions(backends, { webgl: a, webgpu: b }, scene, settings, 'visible'))
        .toMatchObject({ webgl: 0, webgpu: 0 })
      for (const [backend, image] of [[backends.webgl, a], [backends.webgpu, b]] as const) {
        expect((await backend.render(scene, settings, 'production', false)).color).toEqual(image.color)
      }
      // These color/raster boundary counterexamples must still be rejected.
      expect(result.passed).toBe(false)
    }
  })
}, 120000)
