import type { Settings } from './data'

export type AtlasPacking = NonNullable<Settings['atlasPacking']>
export type AtlasImage = { width: number; height: number; bytes: Uint8Array }
export type AtlasRect = { x: number; y: number; width: number; height: number }
export type AtlasLayout = {
  width: number; height: number; bytes: Uint8Array; coords: Float32Array; coordsSize: number;
  images: AtlasImage[]; rects: AtlasRect[]; columns: number; rows: number; cell: number;
}
export const PACKING_NAMES = ['npot-square', 'npot-rectangle', 'npot-scaled', 'pot-padded'] as const
export const PACKING_SOURCES: AtlasImage[] = [[31, 17], [19, 29], [7, 23], [13, 9], [1, 11]].map(([width, height], tile) => {
  const bytes = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = width > 1 && (x === 0 || y === 0 || x === width - 1 || y === height - 1)
      const hole = tile === 0 && x >= 6 && x < 11 && y >= 4 && y < 10
      const alpha = tile === 3 || border || hole ? 0 : tile === 4 ? 1 : x >= width - 4 ? 96 : 255
      bytes.set([30 + (x * 7 + tile * 41) % 210, 35 + (y * 9 + tile * 29) % 200, 50 + tile * 37, alpha], (y * width + x) * 4)
    }
  }
  return { width, height, bytes }
})
const layouts = new Map<string, AtlasLayout>()
export function packingLayout (name: Exclude<AtlasPacking, 'baseline'>, gutter = false): AtlasLayout {
  const key = `${name}:${gutter}`; const cached = layouts.get(key); if (cached) return cached
  const columns = 3; const rows = name === 'npot-rectangle' ? 2 : 3
  const cell = name === 'npot-scaled' ? 20 : 31
  const width = (name === 'pot-padded' ? 128 : name === 'npot-scaled' ? 62 : 93) + (gutter ? 2 * columns : 0)
  const height = (name === 'npot-rectangle' ? 62 : name === 'pot-padded' ? 128 : name === 'npot-scaled' ? 62 : 93) + (gutter ? 2 * rows : 0)
  const bytes = new Uint8Array(width * height * 4); const coordsSize = 3
  const coords = new Float32Array(coordsSize * coordsSize * 4).fill(-1); const rects: AtlasRect[] = []
  const images = PACKING_SOURCES.map((source, index) => {
    const scale = Math.min(1, cell / Math.max(source.width, source.height))
    const w = Math.floor(source.width * scale); const h = Math.floor(source.height * scale)
    const data = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const offset = (Math.floor(y * source.height / h) * source.width + Math.floor(x * source.width / w)) * 4
        data.set(source.bytes.subarray(offset, offset + 4), (y * w + x) * 4)
      }
    }
    const x = (index % columns) * (cell + (gutter ? 2 : 0)) + Number(gutter)
    const y = Math.floor(index / columns) * (cell + (gutter ? 2 : 0)) + Number(gutter)
    rects.push({ x, y, width: w, height: h }); coords.set([x / width, y / height, (x + w) / width, (y + h) / height], index * 4)
    const border = Number(gutter)
    for (let j = -border; j < h + border; j++) {
      for (let i = -border; i < w + border; i++) {
        const offset = (Math.max(0, Math.min(h - 1, j)) * w + Math.max(0, Math.min(w - 1, i))) * 4
        bytes.set(data.subarray(offset, offset + 4), ((y + j) * width + x + i) * 4)
      }
    }
    return { width: w, height: h, bytes: data }
  })
  const result = { width, height, bytes, coords, coordsSize, images, rects, columns, rows, cell }
  layouts.set(key, result); return result
}

function samplePixels (bytes: Uint8Array, width: number, height: number, x: number, y: number, filter: 'nearest' | 'linear'): number[] {
  const texel = (px: number, py: number, c: number): number =>
    bytes[(Math.max(0, Math.min(height - 1, py)) * width + Math.max(0, Math.min(width - 1, px))) * 4 + c] / 255
  if (filter === 'nearest') return [0, 1, 2, 3].map(c => texel(Math.floor(x), Math.floor(y), c))
  const ix = Math.floor(x - 0.5); const iy = Math.floor(y - 0.5); const tx = x - 0.5 - ix; const ty = y - 0.5 - iy
  return [0, 1, 2, 3].map(c => (texel(ix, iy, c) * (1 - tx) + texel(ix + 1, iy, c) * tx) * (1 - ty) +
    (texel(ix, iy + 1, c) * (1 - tx) + texel(ix + 1, iy + 1, c) * tx) * ty)
}
export function samplePacking (
  name: Exclude<AtlasPacking, 'baseline'>, index: number, u: number, v: number, filter: 'nearest' | 'linear', policy: NonNullable<Settings['atlasIsolation']>
): number[] {
  const layout = packingLayout(name)
  const image = layout.images[index]
  // Independent per-image pixel addressing is the clamp/gutter reference.
  if (policy === 'clamp' || policy === 'gutter') return samplePixels(image.bytes, image.width, image.height, u * image.width, v * image.height, filter)
  const uv = layout.coords.subarray(index * 4, index * 4 + 4)
  const loX = policy === 'inset' ? Math.fround(uv[0] + 0.5 / layout.width) : uv[0]
  const hiX = policy === 'inset' ? Math.fround(uv[2] - 0.5 / layout.width) : uv[2]
  const loY = policy === 'inset' ? Math.fround(uv[1] + 0.5 / layout.height) : uv[1]
  const hiY = policy === 'inset' ? Math.fround(uv[3] - 0.5 / layout.height) : uv[3]
  return samplePixels(layout.bytes, layout.width, layout.height,
    (loX + (hiX - loX) * u) * layout.width, (loY + (hiY - loY) * v) * layout.height, filter)
}
// Work in source texel units before dividing. For the frozen dyadic screen
// positions, numerator * integer image size is exact in binary64. Normalizing
// to u first can put a mathematical integer boundary on its preceding texel.
export function samplePackingPixel (
  name: Exclude<AtlasPacking, 'baseline'>, index: number, dx: number, dy: number, diameter: number, filter: 'nearest' | 'linear'
): number[] {
  const image = packingLayout(name).images[index]
  return samplePixels(image.bytes, image.width, image.height,
    ((dx + diameter * 0.5) * image.width) / diameter, ((dy + diameter * 0.5) * image.height) / diameter, filter)
}
export function packingExport (name: Exclude<AtlasPacking, 'baseline'>, gutter = false): object {
  const layout = packingLayout(name, gutter)
  return {
    name,
    gutter,
    width: layout.width,
    height: layout.height,
    coordsSize: layout.coordsSize,
    format: 'rgba8unorm',
    mipLevels: 1,
    bytes: Array.from(layout.bytes),
    coords: Array.from(layout.coords),
    rects: layout.rects,
    images: layout.images.map(image => ({ ...image, bytes: Array.from(image.bytes) })),
    sources: PACKING_SOURCES.map(image => ({ ...image, bytes: Array.from(image.bytes) })),
  }
}
