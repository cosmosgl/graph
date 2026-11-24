import { comparePixels, type PixelComparison } from '../../runtime/compare-pixels'
import { background } from './fixture'
import type { LineSnapshot } from './frame'

function paintMask (image: ImageData): Uint8Array {
  const mask = new Uint8Array(image.width * image.height)
  for (let i = 0; i < mask.length; i++) {
    mask[i] = Number(image.data[i * 4] !== background[0] || image.data[i * 4 + 1] !== background[1] ||
      image.data[i * 4 + 2] !== background[2] || image.data[i * 4 + 3] !== 255)
  }
  return mask
}

export function compareLines (gl: LineSnapshot, gpu: LineSnapshot, overlay?: ImageData):
PixelComparison & { outsideEdgeBand: number; interiorColorFailures: number; pickFailures: number } {
  const exact = comparePixels(gl.pixels, gpu.pixels, overlay)
  const a = paintMask(gl.pixels)
  const b = paintMask(gpu.pixels)
  const { width, height } = gl.pixels
  const neighbors = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1]
  let outsideEdgeBand = 0
  let interiorColorFailures = 0
  for (let i = 0; i < a.length; i++) {
    const x = i % width
    const y = Math.floor(i / width)
    if (a[i] !== b[i]) {
      const other = a[i] ? b : a
      if (!(x > 0 && other[i - 1]) && !(x + 1 < width && other[i + 1]) &&
        !(y > 0 && other[i - width]) && !(y + 1 < height && other[i + width])) outsideEdgeBand++
    } else if (a[i] && x > 0 && y > 0 && x + 1 < width && y + 1 < height) {
      // A shared interior pixel is surrounded by paint in both masks.
      const interior = neighbors.every(offset => a[i + offset] && b[i + offset])
      if (interior && [0, 1, 2, 3].some(c => Math.abs(gl.pixels.data[4 * i + c]! - gpu.pixels.data[4 * i + c]!) > 2)) interiorColorFailures++
    }
  }
  const pickFailures = gl.picks.filter((p, i) => p.actual !== p.expected || gpu.picks[i]?.actual !== p.expected).length
  return { ...exact, outsideEdgeBand, interiorColorFailures, pickFailures }
}
