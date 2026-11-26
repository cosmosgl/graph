import type { Device, Texture } from '@luma.gl/core'
import { SOURCE_ALPHA_POLICY, SOURCE_BYTE_PICKING_POLICY } from './source-alpha'
import type { Settings } from './data'
import { packingLayout, samplePacking, type AtlasPacking } from './atlas-packing'

export type AtlasIsolation = NonNullable<Settings['atlasIsolation']>
export const ATLAS_ISOLATION_POLICIES: AtlasIsolation[] = ['original', 'clamp', 'inset', 'gutter']

export const ATLAS_PICKING_POLICY = {
  ...SOURCE_BYTE_PICKING_POLICY,
  name: 'atlas-source-byte-picking-original-color',
  alpha: 'max(shapeCoverage * (subpixelArea * fillAlpha), sampledImageAlpha) * globalOpacity; f32',
  picking: '(half-covered shape or in-bounds image with sampled alpha > 0) and source byte > 0',
  color: 'production RGB mix and max(shapeAlpha, imageAlpha); original blending',
}
export const ATLAS_QUANTIZED_POLICY = {
  ...ATLAS_PICKING_POLICY,
  name: 'atlas-preblend-quantized',
  color: 'production RGB mix; source alpha quantized before blending',
  quantizer: SOURCE_ALPHA_POLICY.quantizer,
}

export const ATLAS_SIZE = 64
export const IMAGE_COUNT = 4
export const ATLAS_COORDS = new Float32Array([0, 0, 0.5, 0.5, 0.5, 0, 1, 0.5, 0, 0.5, 0.5, 1, 0.5, 0.5, 1, 1])
const rectangleData = new Map<AtlasPacking, Uint32Array>()
export function sourceTexelRects (packing: AtlasPacking = 'baseline'): Uint32Array {
  const cached = rectangleData.get(packing); if (cached) return cached
  const rectangles = packing === 'baseline'
    ? Array.from({ length: 4 }, (_, image) => [(image % 2) * 32, Math.floor(image / 2) * 32, 32, 32]).flat()
    : packingLayout(packing).rects.flatMap(r => [r.x, r.y, r.width, r.height])
  const data = new Uint32Array(rectangles); rectangleData.set(packing, data); return data
}
// Four deterministic 32×32 images in the production packer's square-grid layout.
// Asymmetric alpha and RGB make flipped rows and wrong atlas rectangles observable.
export const ATLAS_BYTES = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4)
for (let tile = 0; tile < IMAGE_COUNT; tile++) {
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      let rgba = [40 + x * 5, 50 + y * 5, 180, 255]
      if (tile === 0) {
        const border = x < 4 || y < 4 || x >= 28 || y >= 28
        const hole = x >= 8 && x < 16 && y >= 12 && y < 22
        rgba[3] = border || hole ? 0 : x >= 24 ? 96 : 255
      } else if (tile === 1) rgba = [220, 50 + y * 3, 160, 255]
      else if (tile === 2) rgba = [90, 220, 30, 0]
      else rgba = [80, 160, 220, 1]
      const px = (tile % 2) * 32 + x; const py = Math.floor(tile / 2) * 32 + y
      ATLAS_BYTES.set(rgba, (py * ATLAS_SIZE + px) * 4)
    }
  }
}
export const ATLAS_EXPORT = {
  width: ATLAS_SIZE,
  height: ATLAS_SIZE,
  format: 'rgba8unorm',
  mipLevels: 1,
  coords: Array.from(ATLAS_COORDS),
  bytes: Array.from(ATLAS_BYTES),
}

// One duplicated texel on all four edges, including corners. UVs retain the
// original 32-texel extent rather than squeezing it into 31 texel-center units.
export const GUTTER_SIZE = 68
type GutterAtlas = { size: number; coords: Float32Array; bytes: Uint8Array }
const gutters = new Map<number, GutterAtlas>()
export function gutterAtlas (size = GUTTER_SIZE): GutterAtlas {
  if (!Number.isInteger(size) || size < 68) throw new Error('Gutter extent must contain the four 34×34 cells')
  const existing = gutters.get(size); if (existing) return existing
  const coords = new Float32Array(IMAGE_COUNT * 4); const bytes = new Uint8Array(size * size * 4)
  for (let tile = 0; tile < IMAGE_COUNT; tile++) {
    const x = (tile % 2) * 34; const y = Math.floor(tile / 2) * 34
    coords.set([(x + 1) / size, (y + 1) / size, (x + 33) / size, (y + 33) / size], tile * 4)
    for (let j = 0; j < 34; j++) {
      for (let i = 0; i < 34; i++) {
        const sx = (tile % 2) * 32 + Math.max(0, Math.min(31, i - 1))
        const sy = Math.floor(tile / 2) * 32 + Math.max(0, Math.min(31, j - 1))
        const offset = (sy * ATLAS_SIZE + sx) * 4
        bytes.set(ATLAS_BYTES.subarray(offset, offset + 4), ((y + j) * size + x + i) * 4)
      }
    }
  }
  const result = { size, coords, bytes }; gutters.set(size, result); return result
}
export const GUTTER_COORDS = gutterAtlas().coords
export const GUTTER_BYTES = gutterAtlas().bytes
export function atlasInfo (packing: AtlasPacking = 'baseline'): { imageCount: number; coordsSize: number } {
  if (packing === 'baseline') return { imageCount: IMAGE_COUNT, coordsSize: 2 }
  const layout = packingLayout(packing); return { imageCount: layout.images.length, coordsSize: layout.coordsSize }
}
export function atlasCoords (policy: AtlasIsolation, gutterExtent = GUTTER_SIZE, packing: AtlasPacking = 'baseline'): Float32Array {
  if (packing !== 'baseline') {
    const layout = packingLayout(packing, policy === 'gutter')
    if (policy !== 'inset') return layout.coords
    return layout.coords.map((v, i) => v < 0 ? v : v + (i % 4 < 2 ? 0.5 : -0.5) / (i % 2 === 0 ? layout.width : layout.height))
  }
  if (policy === 'gutter') return gutterAtlas(gutterExtent).coords
  if (policy !== 'inset') return ATLAS_COORDS
  return ATLAS_COORDS.map((v, i) => v + (i % 4 < 2 ? 0.5 : -0.5) / ATLAS_SIZE)
}
export const ATLAS_ISOLATION_EXPORT = {
  policies: ATLAS_ISOLATION_POLICIES,
  original: ATLAS_EXPORT,
  gutter: {
    width: GUTTER_SIZE,
    height: GUTTER_SIZE,
    format: 'rgba8unorm',
    mipLevels: 1,
    bytes: Array.from(GUTTER_BYTES),
    coords: Array.from(GUTTER_COORDS),
    border: 1,
  },
  reference: 'Independent 32×32 image sampling with per-image clamp-to-edge; original RGB mix, source-alpha rule and budgets',
}

export function atlasTexture (
  device: Device, filter: 'nearest' | 'linear', gutter = false, gutterExtent = GUTTER_SIZE, packing: AtlasPacking = 'baseline'
): Texture {
  if (packing !== 'baseline') {
    const layout = packingLayout(packing, gutter)
    const texture = device.createTexture({
      width: layout.width,
      height: layout.height,
      format: 'rgba8unorm',
      sampler: { minFilter: filter, magFilter: filter, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
    })
    try { texture.copyImageData({ data: layout.bytes, bytesPerRow: layout.width * 4 }); return texture } catch (error) { texture.destroy(); throw error }
  }
  const layout = gutter ? gutterAtlas(gutterExtent) : { size: ATLAS_SIZE, bytes: ATLAS_BYTES }
  const { size, bytes } = layout
  const texture = device.createTexture({
    width: size,
    height: size,
    format: 'rgba8unorm',
    sampler: { minFilter: filter, magFilter: filter, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
  })
  try { texture.copyImageData({ data: bytes, bytesPerRow: size * 4 }); return texture } catch (error) { texture.destroy(); throw error }
}

// Independent CPU nearest/bilinear sampling of the full atlas. The UVs are
// production edge coordinates, not silently inset to isolate individual tiles.
export function sampleAtlas (index: number, u: number, v: number, filter: 'nearest' | 'linear'): number[] {
  const r = ATLAS_COORDS.subarray(index * 4, index * 4 + 4)
  const x = (r[0] + (r[2] - r[0]) * u) * ATLAS_SIZE
  const y = (r[1] + (r[3] - r[1]) * v) * ATLAS_SIZE
  const texel = (px: number, py: number, c: number): number =>
    ATLAS_BYTES[(Math.max(0, Math.min(ATLAS_SIZE - 1, py)) * ATLAS_SIZE + Math.max(0, Math.min(ATLAS_SIZE - 1, px))) * 4 + c] / 255
  if (filter === 'nearest') return [0, 1, 2, 3].map(c => texel(Math.floor(x), Math.floor(y), c))
  const ix = Math.floor(x - 0.5); const iy = Math.floor(y - 0.5); const tx = x - 0.5 - ix; const ty = y - 0.5 - iy
  return [0, 1, 2, 3].map(c => (texel(ix, iy, c) * (1 - tx) + texel(ix + 1, iy, c) * tx) * (1 - ty) +
    (texel(ix, iy + 1, c) * (1 - tx) + texel(ix + 1, iy + 1, c) * tx) * ty)
}

// This reference addresses original tile pixels directly. It neither reads the
// packed gutter bytes nor reproduces the GPU's normalized-coordinate clamp.
export function sampleIsolatedImage (index: number, u: number, v: number, filter: 'nearest' | 'linear'): number[] {
  const texel = (x: number, y: number, c: number): number => {
    const px = (index % 2) * 32 + Math.max(0, Math.min(31, x))
    const py = Math.floor(index / 2) * 32 + Math.max(0, Math.min(31, y))
    return ATLAS_BYTES[(py * ATLAS_SIZE + px) * 4 + c] / 255
  }
  const x = u * 32; const y = v * 32
  if (filter === 'nearest') return [0, 1, 2, 3].map(c => texel(Math.floor(x), Math.floor(y), c))
  const ix = Math.floor(x - 0.5); const iy = Math.floor(y - 0.5); const tx = x - 0.5 - ix; const ty = y - 0.5 - iy
  return [0, 1, 2, 3].map(c => (texel(ix, iy, c) * (1 - tx) + texel(ix + 1, iy, c) * tx) * (1 - ty) +
    (texel(ix, iy + 1, c) * (1 - tx) + texel(ix + 1, iy + 1, c) * tx) * ty)
}
export function sampleAtlasPolicy (
  index: number, u: number, v: number, filter: 'nearest' | 'linear', policy: AtlasIsolation, packing: AtlasPacking = 'baseline'
): number[] {
  if (packing !== 'baseline') return samplePacking(packing, index, u, v, filter, policy)
  if (policy === 'original') return sampleAtlas(index, u, v, filter)
  if (policy === 'inset') return sampleAtlas(index, (0.5 + u * 31) / 32, (0.5 + v * 31) / 32, filter)
  return sampleIsolatedImage(index, u, v, filter)
}
