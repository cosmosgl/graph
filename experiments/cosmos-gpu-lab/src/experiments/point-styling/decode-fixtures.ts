import type { AtlasImage } from './atlas-packing'

export const DECODE_SPACES = ['untagged', 'srgb', 'linear-srgb', 'display-p3'] as const
export type DecodeSpace = typeof DECODE_SPACES[number]
export const DECODE_WIDTH = 9; export const DECODE_HEIGHT = 5
export const DECODE_PIXELS = new Uint8Array(DECODE_WIDTH * DECODE_HEIGHT * 4)
const palette = [[153, 102, 51], [51, 153, 102], [51, 102, 153], [128, 128, 128], [220, 110, 80],
  [40, 180, 130], [110, 70, 200], [230, 190, 100], [80, 130, 180]]
for (let y = 0; y < DECODE_HEIGHT; y++) {
  for (let x = 0; x < DECODE_WIDTH; x++) {
    const alpha = y === 1
      ? [0, 1, 2, 32, 64, 128, 192, 254, 255][x]
      : y === 2 ? [255, 128, 64, 32, 2, 1, 0, 254, 192][x] : y === 4 && x === 4 ? 0 : 255
    DECODE_PIXELS.set([...palette[(x + y * 3) % palette.length], alpha], (y * DECODE_WIDTH + x) * 4)
  }
}
// Matrices/transfer functions from CSS Color 4. The generated ICC fixture uses
// D50 PCS colorants; the independent expected colors below convert in D65.
const srgbMatrix = [[0.4123907993, 0.3575843394, 0.1804807884], [0.2126390059, 0.7151686788, 0.0721923154],
  [0.0193308187, 0.1191947798, 0.9505321522]]
const p3Matrix = [[0.4865709486, 0.2656676932, 0.1982172852], [0.2289745641, 0.6917385218, 0.0792869141],
  [0, 0.0451133819, 1.0439443689]]
const adapt = [[1.0479298208, 0.0229467933, -0.0501922295], [0.0296278157, 0.9904344846, -0.0170738250],
  [-0.0092430582, 0.0150551449, 0.7518742814]]
const inverseSrgb = [[3.2409699419, -1.5373831776, -0.4986107603], [-0.9692436363, 1.8759675015, 0.0415550574],
  [0.0556300797, -0.2039769589, 1.0569715142]]
const multiply = (matrix: number[][], rgb: number[]): number[] => matrix.map(row => row.reduce((sum, n, i) => sum + n * rgb[i], 0))
const linear = (v: number): number => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
const encoded = (v: number): number => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
export function expectedDecoded (space: DecodeSpace): AtlasImage {
  const bytes = DECODE_PIXELS.slice()
  for (let i = 0; i < bytes.length; i += 4) {
    const rgb = Array.from(bytes.subarray(i, i + 3), v => v / 255)
    const result = space === 'linear-srgb'
      ? rgb.map(encoded)
      : space === 'display-p3' ? multiply(inverseSrgb, multiply(p3Matrix, rgb.map(linear))).map(encoded) : rgb
    result.forEach((v, c) => { bytes[i + c] = Math.round(Math.max(0, Math.min(1, v)) * 255) })
  }
  return { width: DECODE_WIDTH, height: DECODE_HEIGHT, bytes }
}
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text)
const join = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}
const integer = (n: number): Uint8Array => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b }
function fixed (values: number[], type = 'XYZ '): Uint8Array {
  const data = new Uint8Array(8 + values.length * 4); data.set(ascii(type))
  const view = new DataView(data.buffer); values.forEach((n, i) => view.setInt32(8 + i * 4, Math.round(n * 65536)))
  return data
}
function textTag (text: string): Uint8Array {
  const b = new Uint8Array(28 + text.length * 2); b.set(ascii('mluc')); const view = new DataView(b.buffer)
  view.setUint32(8, 1); view.setUint32(12, 12); b.set(ascii('enUS'), 16); view.setUint32(20, text.length * 2); view.setUint32(24, 28)
  for (let i = 0; i < text.length; i++) view.setUint16(28 + i * 2, text.charCodeAt(i))
  return b
}
function profile (space: 'linear-srgb' | 'display-p3'): Uint8Array {
  const matrix = space === 'display-p3' ? p3Matrix : srgbMatrix
  const colorants = [0, 1, 2].map(i => multiply(adapt, matrix.map(row => row[i])))
  // ICC parametricCurveType 0 (linear) or 3 (the sRGB transfer curve).
  const params = space === 'linear-srgb' ? [1] : [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045]
  const curve = new Uint8Array(12 + params.length * 4); curve.set(ascii('para')); const cv = new DataView(curve.buffer)
  cv.setUint16(8, space === 'linear-srgb' ? 0 : 3); params.forEach((n, i) => cv.setInt32(12 + i * 4, Math.round(n * 65536)))
  const tags: Array<[string, Uint8Array]> = [
    ['desc', textTag(`Cosmos lab ${space}`)], ['cprt', textTag('Generated Cosmos test fixture')], ['wtpt', fixed([0.9642, 1, 0.8249])],
    ['chad', fixed(adapt.flat(), 'sf32')], ...colorants.map((v, i): [string, Uint8Array] => [['rXYZ', 'gXYZ', 'bXYZ'][i], fixed(v)]),
    ...['rTRC', 'gTRC', 'bTRC'].map((key): [string, Uint8Array] => [key, curve]),
  ]
  let offset = 132 + tags.length * 12
  const total = offset + tags.reduce((n, [, tag]) => n + Math.ceil(tag.length / 4) * 4, 0)
  const data = new Uint8Array(total); const v = new DataView(data.buffer)
  v.setUint32(0, total); v.setUint32(8, 0x04400000); data.set(ascii('mntrRGB XYZ '), 12)
  ;[2026, 11, 14, 0, 0, 0].forEach((n, i) => v.setUint16(24 + i * 2, n))
  data.set(ascii('acsp'), 36); v.setUint32(64, 1); data.set(fixed([0.9642, 1, 0.8249]).subarray(8), 68)
  v.setUint32(128, tags.length)
  tags.forEach(([name, tag], i) => {
    data.set(ascii(name), 132 + i * 12); v.setUint32(136 + i * 12, offset); v.setUint32(140 + i * 12, tag.length)
    data.set(tag, offset); offset += Math.ceil(tag.length / 4) * 4
  })
  return data
}
// A tiny deterministic PNG encoder: filter 0, one uncompressed zlib block.
// No canvas encode/decode round trip can discard hidden RGB before the test.
function deflate (data: Uint8Array): Uint8Array {
  if (data.length > 65535) throw new Error('Fixture exceeds one stored deflate block')
  let a = 1; let b = 0; for (const n of data) { a = (a + n) % 65521; b = (b + a) % 65521 }
  return join(new Uint8Array([0x78, 0x01, 1, data.length & 255, data.length >> 8, (~data.length) & 255, ((~data.length) >> 8) & 255]),
    data, integer(((b << 16) | a) >>> 0))
}
function chunk (name: string, data: Uint8Array): Uint8Array {
  const content = join(ascii(name), data); let crc = 0xffffffff
  for (const b of content) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return join(integer(data.length), content, integer((crc ^ 0xffffffff) >>> 0))
}
export function decodingPng (space: DecodeSpace): Blob {
  const header = join(integer(DECODE_WIDTH), integer(DECODE_HEIGHT), new Uint8Array([8, 6, 0, 0, 0]))
  const rows = new Uint8Array(DECODE_HEIGHT * (DECODE_WIDTH * 4 + 1))
  for (let y = 0; y < DECODE_HEIGHT; y++) {
    rows.set(DECODE_PIXELS.subarray(y * DECODE_WIDTH * 4, (y + 1) * DECODE_WIDTH * 4),
      y * (DECODE_WIDTH * 4 + 1) + 1)
  }
  const color = space === 'untagged'
    ? new Uint8Array()
    : space === 'srgb'
      ? chunk('sRGB', new Uint8Array([1]))
      : chunk('iCCP', join(ascii('Cosmos lab'), new Uint8Array([0, 0]), deflate(profile(space))))
  return new Blob([join(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), color,
    chunk('IDAT', deflate(rows)), chunk('IEND', new Uint8Array()))], { type: 'image/png' })
}
