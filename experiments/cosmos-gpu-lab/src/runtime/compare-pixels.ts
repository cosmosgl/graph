export type PixelComparison = { differingPixels: number; totalPixels: number; maxChannelDelta: number }

/** Compare all four bytes of each native canvas pixel. An optional overlay marks exactly those pixels. */
export function comparePixels (
  left: ImageData, right: ImageData, mask?: ImageData, onDifference?: (pixelIndex: number) => void
): PixelComparison {
  if (left.width !== right.width || left.height !== right.height) throw new Error('The canvas dimensions differ')
  if (mask && (mask.width !== left.width || mask.height !== left.height)) throw new Error('The difference overlay dimensions differ from the canvas')
  mask?.data.fill(0)
  let differingPixels = 0
  let maxChannelDelta = 0
  for (let i = 0; i < left.data.length; i += 4) {
    let delta = 0
    for (let channel = i; channel < i + 4; channel++) {
      delta = Math.max(delta, Math.abs(left.data[channel] - right.data[channel]))
    }
    if (delta === 0) continue
    differingPixels++
    maxChannelDelta = Math.max(maxChannelDelta, delta)
    if (mask) mask.data[i] = mask.data[i + 2] = mask.data[i + 3] = 255
    onDifference?.(i / 4)
  }
  return { differingPixels, totalPixels: left.width * left.height, maxChannelDelta }
}
