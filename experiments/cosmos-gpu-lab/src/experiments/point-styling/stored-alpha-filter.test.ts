import { expect, it } from 'vitest'
import { DEFAULTS, fixture, point, type Point, type Settings } from './data'
import { pointOrder } from './point-effects'
import { storedAlphaCandidates } from './stored-alpha-filter'
import { alphaBoundarySamples } from './alpha-conversion'
import { createStylingWebGL } from './webgl'
import { createStylingWebGPU } from './webgpu'
import {
  assertStoredAlphaMatch, measureFilteredAlphaCase, runFilteredAlphaCost, summarizeFilteredAlpha, type FilteredAlphaCostRow,
} from './stored-alpha-filter-study'
import { pick } from './backend'
import { cropRegion, type PixelRegion } from './stored-alpha'

it('conservative bounds retain uncertain inputs, edge carriers and original ordered IDs', () => {
  const points = [point(20, 20), point(251.5, 160.5, 1, { size: 1 }), point(256, 160), point(1e30, 160),
    point(256, 160, 8, { size: 0, image: 0, imageSize: NaN })]
  const settings = { ...DEFAULTS, reverse: true }
  expect(storedAlphaCandidates(points, settings, { x: 250, y: 154, width: 14, height: 14 }, pointOrder(points, settings))).toEqual([4, 3, 2, 1])
})

for (const [lane, create] of [['webgl', createStylingWebGL], ['webgpu', createStylingWebGPU]] as const) {
  it(`${lane}: filtered stored-alpha preserves exact IDs, colors, boundaries and fall-through`, async () => {
    const backend = await create(document.createElement('canvas'))
    try {
      const r = { x: 250, y: 154, width: 14, height: 14 }
      const check = async (points: Point[], settings: Settings, region: PixelRegion): Promise<void> => {
        const original = await backend.render(points, settings, false, 'explicit', false)
        const prototype = await backend.render(points, settings, false, 'explicit', false, { region, audit: true })
        const filtered = await backend.render(points, settings, false, 'explicit', false, { region, candidate: 'filtered', audit: true })
        assertStoredAlphaMatch(prototype, filtered, original)
        const trace = filtered.storedAlpha!
        expect(trace.passes).toBe(1 + trace.candidateCount * 3)
        expect(cropRegion(filtered.ids, filtered.width, region)).toEqual(trace.cpuIds)
        // Every omitted point must have no eligible stored paint anywhere in the
        // request. This checks the broad phase against actual GPU rasterization.
        const retained = new Set(trace.layers.map(l => l.id))
        expect(trace.layers.map(l => l.id)).toEqual(prototype.storedAlpha!.layers.map(l => l.id).filter(id => retained.has(id)))
        for (const layer of prototype.storedAlpha!.layers.filter(l => !retained.has(l.id))) {
          expect(layer.paint.every((alpha, i) => i % 4 !== 3 || alpha === 0 || layer.geometry[i] === 0), `culled ${layer.id}`).toBe(true)
        }
      }
      const boundary = alphaBoundarySamples()[3]
      const points = [point(20, 20), point(256.5, 160.5, 1, { size: 32, greyed: true }), point(480, 290),
        point(256.5, 160.5, 0, { size: 8, color: [1, 1, 1, boundary] }),
        point(256.5, 160.5, 0, { size: 12, color: [1, 1, 1, 1 / 65536] })]
      for (const ratio of [1, 2]) {
        for (const reverse of [false, true]) {
          for (const opacity of [0, 0.35, 1]) {
            await check(points, { ...DEFAULTS, ratio, reverse, opacity, highlighting: true },
              { x: r.x * ratio, y: r.y * ratio, width: r.width * ratio, height: r.height * ratio })
          }
        }
      }
      const fallthrough = await backend.render(points, DEFAULTS, false, 'explicit', false, { region: r, candidate: 'filtered' })
      expect(pick(fallthrough, 256, 160)).not.toBe(4)
      for (const name of ['shapes', 'fractional', 'edge-cases', 'atlas-shapes', 'atlas-overlap', 'atlas-edges', 'atlas-packing-overlap'] as const) {
        const scene = fixture(name)
        for (const p of scene.slice(0, 3)) {
          await check(scene, { ...DEFAULTS, atlasIsolation: 'texel', atlasPacking: 'npot-rectangle' },
            { x: Math.max(0, Math.min(496, Math.floor(p.x) - 8)), y: Math.max(0, Math.min(304, Math.floor(p.y) - 8)), width: 16, height: 16 })
        }
      }
      // Closed carrier boundaries, fractional transform, clamping, NaN defaults,
      // subpixel sizes and larger image carriers, on all four sides of the ROI.
      for (const zoom of [0.75, 2]) {
        for (const scaleOnZoom of [true, false]) {
          const scene = Array.from({ length: 16 }, (_, i) => point(256 + (i % 4 - 1.5) * 12.5, 160 + (Math.floor(i / 4) - 1.5) * 12.5, i % 8,
            { size: [0.25, NaN, 7.5, 240][i % 4], image: i % 3 === 0 ? 0 : undefined, imageSize: 31.5 }))
          await check(scene, { ...DEFAULTS, zoom, scaleOnZoom, sizeScale: 0.75, maxSize: 24 }, r)
        }
      }
      await check(points, DEFAULTS, { x: 0, y: 300, width: 4, height: 4 })
      await check([], DEFAULTS, r)
      const empty = await backend.render(points, DEFAULTS, false, 'explicit', false,
        { region: { x: 0, y: 300, width: 4, height: 4 }, candidate: 'filtered', measure: 'gpu' })
      expect(empty.storedAlpha!.passes).toBe(1); expect(empty.ids.every(v => v === 0)).toBe(true)
    } finally { backend.destroy() }
  }, 180000)

  it(`${lane}: compares filtered and prototype request cost with exact outputs`, async () => {
    const backend = await create(document.createElement('canvas'))
    try {
      for (const dense of [false, true]) {
        const row = (await measureFilteredAlphaCase(backend, lane, 64, dense, () => false, 2))!
        expect(row.valid).toBe(true); expect(row.candidates).toBe(dense ? 64 : 4)
        expect(row.prototypePasses).toBe(193); expect(row.filteredPasses).toBe(dense ? 193 : 13)
        for (const s of [...row.prototype, ...row.filtered]) {
          expect(s.requestWallMs).toBeGreaterThanOrEqual(s.completionWallMs + s.selectionCpuMs)
          expect(s.completionWallMs).toBeGreaterThanOrEqual(s.encodeSubmitCpuMs)
        }
      }
      expect(await measureFilteredAlphaCase(backend, lane, 16, false, () => true)).toBeUndefined()
    } finally { backend.destroy() }
  }, 120000)
}

declare module 'vitest' { interface TaskMeta { filteredAlphaCost?: FilteredAlphaCostRow[] } }
it.skipIf(!import.meta.env.LAB_STORED_ALPHA_SWEEP)('records paired filtered stored-alpha cost on the selected adapter', async ({ task }) => {
  const rows: FilteredAlphaCostRow[] = []; task.meta.filteredAlphaCost = rows
  await runFilteredAlphaCost(row => {
    rows.push(row)
    // eslint-disable-next-line no-console
    console.info('Filtered-alpha cost', JSON.stringify({
      lane: row.lane,
      device: row.device,
      count: row.count,
      overlap: row.overlapping,
      candidates: row.candidates,
      passes: [row.prototypePasses, row.filteredPasses],
      valid: row.valid,
      ...summarizeFilteredAlpha(row),
    }))
  }, () => false)
  expect(rows).toHaveLength(16); expect(rows.every(r => r.valid)).toBe(true)
}, 600000)
