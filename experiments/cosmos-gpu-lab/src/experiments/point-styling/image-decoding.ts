import type { Backend } from './backend'
import type { AtlasImage } from './atlas-packing'
import { decodingPng, DECODE_PIXELS, DECODE_SPACES, expectedDecoded, type DecodeSpace } from './decode-fixtures'
import { COLOR_BUDGET } from './reference'

export const DECODE_POLICIES = [
  {
    id: 'production',
    label: 'Image + canvas',
    name: 'Production image + canvas',
    bitmap: false,
    external: false,
    conversion: 'default',
    alpha: 'none',
    orientation: 'from-image',
  },
  {
    id: 'normalized',
    label: 'Straight bitmap → bytes',
    name: 'Straight bitmap → sRGB ImageData',
    bitmap: true,
    external: false,
    conversion: 'default',
    alpha: 'none',
    orientation: 'from-image',
  },
  {
    id: 'normalized-premultiplied',
    label: 'Premult bitmap → bytes',
    name: 'Premultiplied bitmap → sRGB ImageData',
    bitmap: true,
    external: false,
    conversion: 'default',
    alpha: 'premultiply',
    orientation: 'from-image',
  },
  {
    id: 'external',
    label: 'Straight bitmap → texture',
    name: 'Straight bitmap → luma',
    bitmap: true,
    external: true,
    conversion: 'default',
    alpha: 'none',
    orientation: 'from-image',
  },
  {
    id: 'unmanaged',
    label: 'No conversion · control',
    name: 'No color conversion · control',
    bitmap: true,
    external: false,
    conversion: 'none',
    alpha: 'none',
    orientation: 'from-image',
  },
  {
    id: 'premultiplied',
    label: 'Premult bitmap → texture',
    name: 'Premultiplied bitmap · control',
    bitmap: true,
    external: true,
    conversion: 'default',
    alpha: 'premultiply',
    orientation: 'from-image',
  },
  {
    id: 'flipped',
    label: 'Flipped bitmap · control',
    name: 'Flipped bitmap · control',
    bitmap: true,
    external: true,
    conversion: 'default',
    alpha: 'none',
    orientation: 'flipY',
  },
] as const
export type DecodePolicy = typeof DECODE_POLICIES[number]['id']
export type DecodedImages = {
  policy: DecodePolicy; images: AtlasImage[]; bitmaps: ImageBitmap[]; colorSpaces: string[];
  encoded: Array<{ space: DecodeSpace; png: number[] }>; close(): void;
}
function readCanvas (source: CanvasImageSource, width: number, height: number, production: boolean): { image: AtlasImage; colorSpace: string } {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  // Keep the production story's default canvas path verbatim; candidate
  // normalization explicitly requests sRGB. Both request default RGBA8 readback.
  const ctx = production ? canvas.getContext('2d') : canvas.getContext('2d', { colorSpace: 'srgb' })
  if (!ctx) throw new Error('2D image decoder unavailable')
  ctx.drawImage(source, 0, 0)
  const data = production ? ctx.getImageData(0, 0, width, height) : ctx.getImageData(0, 0, width, height, { colorSpace: 'srgb' })
  return { image: { width, height, bytes: new Uint8Array(data.data) }, colorSpace: data.colorSpace }
}
export async function decodeImages (policy: DecodePolicy): Promise<DecodedImages> {
  const options = DECODE_POLICIES.find(p => p.id === policy)!
  const images: AtlasImage[] = []; const bitmaps: ImageBitmap[] = []; const colorSpaces: string[] = []
  const encoded: DecodedImages['encoded'] = []
  try {
    for (const space of DECODE_SPACES) {
      const blob = decodingPng(space); encoded.push({ space, png: Array.from(new Uint8Array(await blob.arrayBuffer())) })
      if (options.bitmap) {
        const bitmap = await createImageBitmap(blob, {
          imageOrientation: options.orientation, premultiplyAlpha: options.alpha, colorSpaceConversion: options.conversion,
        })
        bitmaps.push(bitmap)
        const decoded = readCanvas(bitmap, bitmap.width, bitmap.height, false)
        images.push(decoded.image); colorSpaces.push(decoded.colorSpace)
      } else {
        const url = URL.createObjectURL(blob); const image = new Image()
        try {
          await new Promise<void>((resolve, reject) => {
            image.onload = (): void => { resolve() }
            image.onerror = (): void => { reject(new Error(`Unable to decode ${space} PNG`)) }; image.src = url
          })
          const decoded = readCanvas(image, image.width, image.height, true)
          images.push(decoded.image); colorSpaces.push(decoded.colorSpace)
        } finally { URL.revokeObjectURL(url) }
      }
    }
    return { policy, images, bitmaps, colorSpaces, encoded, close (): void { bitmaps.forEach(bitmap => bitmap.close()) } }
  } catch (error) { bitmaps.forEach(bitmap => bitmap.close()); throw error }
}
export type DecodeAudit = {
  space: DecodeSpace; colorSpace: string; dimensionsMatch: boolean; opaqueColorFailures: number; maxOpaqueError: number; alphaDifferences: number;
  normalizedColorFailures: number; normalizedChangedPixels: number; maxNormalizedError: number;
  hiddenRgbChanged: number; nonopaqueRgbChanged: number; firstOpaqueMismatch?: { x: number; y: number; actual: number[]; expected: number[] };
  valid: boolean;
}
export function auditDecoded (decoded: DecodedImages, reference: DecodedImages): DecodeAudit[] {
  return DECODE_SPACES.map((space, image) => {
    const bytes = decoded.images[image].bytes; const expected = expectedDecoded(space).bytes; const control = reference.images[image].bytes
    const result: DecodeAudit = {
      space,
      colorSpace: decoded.colorSpaces[image],
      dimensionsMatch: decoded.images[image].width === reference.images[image].width && decoded.images[image].height === reference.images[image].height,
      opaqueColorFailures: 0,
      maxOpaqueError: 0,
      alphaDifferences: 0,
      normalizedColorFailures: 0,
      normalizedChangedPixels: 0,
      maxNormalizedError: 0,
      hiddenRgbChanged: 0,
      nonopaqueRgbChanged: 0,
      valid: false,
    }
    for (let i = 0; i < bytes.length; i += 4) {
      const error = Math.max(...[0, 1, 2].map(c => Math.abs(bytes[i + c] - expected[i + c])))
      const difference = Math.max(...[0, 1, 2, 3].map(c => Math.abs(bytes[i + c] - control[i + c])))
      if (DECODE_PIXELS[i + 3] === 255) {
        result.maxOpaqueError = Math.max(result.maxOpaqueError, error)
        if (error > COLOR_BUDGET) {
          result.opaqueColorFailures++
          result.firstOpaqueMismatch ??= {
            x: (i / 4) % decoded.images[image].width,
            y: Math.floor(i / 4 / decoded.images[image].width),
            actual: Array.from(bytes.subarray(i, i + 4)),
            expected: Array.from(expected.subarray(i, i + 4)),
          }
        }
      }
      if (bytes[i + 3] !== DECODE_PIXELS[i + 3]) result.alphaDifferences++
      if (difference) result.normalizedChangedPixels++
      if (difference > COLOR_BUDGET) result.normalizedColorFailures++
      result.maxNormalizedError = Math.max(result.maxNormalizedError, difference)
      const sourceDifference = [0, 1, 2].some(c => bytes[i + c] !== expected[i + c])
      if (DECODE_PIXELS[i + 3] === 0 && sourceDifference) result.hiddenRgbChanged++
      if (DECODE_PIXELS[i + 3] > 0 && DECODE_PIXELS[i + 3] < 255 && sourceDifference) result.nonopaqueRgbChanged++
    }
    result.valid = result.dimensionsMatch && result.colorSpace === 'srgb' && result.opaqueColorFailures === 0 && result.alphaDifferences === 0 &&
      result.normalizedColorFailures === 0
    return result
  })
}
export function installDecoded (backend: Backend, decoded: DecodedImages): void {
  const external = DECODE_POLICIES.find(p => p.id === decoded.policy)!.external
  backend.atlas.replace(decoded.images, { external })
  if (!external) return
  const layout = backend.atlas.layout!
  decoded.bitmaps.forEach((bitmap, index) => {
    const rect = layout.rects[index]
    for (const filter of ['nearest', 'linear'] as const) {
      backend.atlas.texture(filter).copyExternalImage({
        image: bitmap,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        colorSpace: 'srgb',
        premultipliedAlpha: false,
        flipY: false,
      })
    }
  })
}
export function renderDecodeAudit (host: HTMLElement, audit: DecodeAudit[], policy: DecodePolicy): void {
  host.innerHTML = `<h3>Decoded source and color handling</h3><p>${DECODE_POLICIES.find(p => p.id === policy)!.name}.
    Exact alpha/orientation and opaque ICC color intent (2/255) are checked before upload. All normalized bytes are also compared
    with production ImageData at 2/255. Transparent and low-alpha RGB round-trip changes from the encoded file remain reported.</p>
    <table data-decode-audit><thead><tr><th>PNG profile</th><th>Source</th><th>Opaque color failures / max</th><th>Alpha differences</th>
      <th>Normalized pixels beyond 2/255</th><th>Hidden / translucent RGB changes</th></tr></thead><tbody>
    ${audit.map(r => `<tr><td>${r.space}</td><td>${r.valid ? 'Pass' : 'Fail'}</td><td>${r.opaqueColorFailures} / ${r.maxOpaqueError}</td>
      <td>${r.alphaDifferences}</td>
      <td>${r.normalizedColorFailures}</td><td>${r.hiddenRgbChanged} / ${r.nonopaqueRgbChanged}</td></tr>`).join('')}</tbody></table>`
}
