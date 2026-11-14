import { expect, it } from 'vitest'
import { PACKING_NAMES, packingLayout, samplePacking, samplePackingPixel } from './atlas-packing'
import { PACKING_FIXTURES, PACKING_PROFILES } from './atlas-packing-study'
import { DEFAULTS, center, diameter, fixture } from './data'
import { prepareReferencePick, referencePick } from './reference'

it('computes the ideal texel boundary before normalization rather than flooring a cancellation artifact', () => {
  const old = samplePacking('npot-square', 0, -13 / 62 + 0.5, -27 / 62 + 0.5, 'nearest', 'clamp')
  const direct = samplePackingPixel('npot-square', 0, -13, -27, 62, 'nearest')
  expect(old.map(x => Math.round(x * 255))).toEqual([86, 44, 50, 255])
  expect(direct.map(x => Math.round(x * 255))).toEqual([93, 44, 50, 255])
  expect(((-13 + 31) * 31) / 62).toBe(9)
  const f = Math.fround
  const normalizedY = f(f(f(-27 * f(2 / 58)) + 1) * 0.5)
  expect(f(normalizedY * 29)).toBeLessThan(1)
  expect(f(f(-27 + 29) * f(29 / 58))).toBe(1)
})

it('matches exact rational nearest indices for every isolated source pixel in the packing matrix', () => {
  let checked = 0; let failures = 0
  for (const name of PACKING_NAMES) {
    const layout = packingLayout(name)
    for (const fixtureName of PACKING_FIXTURES) {
      for (const profile of PACKING_PROFILES) {
        const settings = { ...DEFAULTS, ...profile.settings }
        for (const p of fixture(fixtureName)) {
          if (p.image === undefined) continue
          const image = layout.images[p.image]; const d = diameter({ ...p, size: p.imageSize! }, settings)
          const [cx, cy] = center(p, settings)
          const exact = (offset: number, size: number): number => {
            const n = (offset + d / 2) * 4; const divisor = d * 4
            if (!Number.isInteger(n) || !Number.isInteger(divisor)) throw new Error('Exact-rational fixture requires quarter-pixel inputs')
            return Math.max(0, Math.min(size - 1, Number((BigInt(n) * BigInt(size)) / BigInt(divisor))))
          }
          const left = Math.max(0, Math.ceil(cx - d / 2 - 0.5)); const right = Math.min(512 * settings.ratio - 1, Math.floor(cx + d / 2 - 0.5))
          const top = Math.max(0, Math.ceil(cy - d / 2 - 0.5)); const bottom = Math.min(320 * settings.ratio - 1, Math.floor(cy + d / 2 - 0.5))
          for (let y = top; y <= bottom; y++) {
            const iy = exact(y + 0.5 - cy, image.height)
            for (let x = left; x <= right; x++) {
              const ix = exact(x + 0.5 - cx, image.width); const offset = (iy * image.width + ix) * 4
              const actual = samplePackingPixel(name, p.image, x + 0.5 - cx, y + 0.5 - cy, d, 'nearest')
              if (actual.some((value, c) => value !== image.bytes[offset + c] / 255)) failures++
              checked++
            }
          }
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(100000); expect(failures).toBe(0)
})

it('preserves scalar picking when the CPU audit skips conservative point bounds', () => {
  let seed = 17; let failures = 0
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  for (const name of ['edge-cases', 'fractional', 'atlas-overlap', 'atlas-packing-edges', 'atlas-packing-overlap'] as const) {
    for (const atlasPacking of ['baseline', 'npot-square', 'npot-rectangle', 'npot-scaled'] as const) {
      for (const opacity of [0, 0.35, 1]) {
        const settings = { ...DEFAULTS, atlasPacking, atlasIsolation: 'clamp' as const, opacity, reverse: opacity === 0.35 }
        const points = fixture(name)
        for (const rule of ['legacy', 'visible', 'source-alpha'] as const) {
          const prepared = prepareReferencePick(points, settings, rule)
          const samples: Array<[number, number]> = Array.from({ length: 400 }, () => [Math.floor(random() * 512) + 0.5, Math.floor(random() * 320) + 0.5])
          for (const p of points) {
            const [cx, cy] = center(p, settings); const d = Math.max(1, diameter(p, settings), p.imageSize ?? 0)
            for (const shift of [-d / 2 - 1, -d / 2, 0, d / 2, d / 2 + 1]) samples.push([cx + shift, cy], [cx, cy + shift])
          }
          for (const [x, y] of samples) if (prepared(x, y) !== referencePick(points, settings, x, y, rule)) failures++
        }
      }
    }
  }
  expect(failures).toBe(0)
})
