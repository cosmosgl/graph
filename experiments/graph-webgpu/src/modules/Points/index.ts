import type { Device, Texture } from '@luma.gl/core'
import type { GraphConfigInterface } from '@/graph/config'
import { getRgbaColor, isNumber, rgbToBrightness } from '@/graph/helper'
import type { GraphData } from '@/graph/modules/GraphData'
import { createAtlasDataFromImageData } from '@/graph/modules/Points/atlas-utils'
import { PointHighlightMask } from './highlights'

type Rgba = [number, number, number, number]
const noColor: Rgba = [0, 0, 0, -1]
const deriveColor: Rgba = [0, 0, 0, -2]
export const pointStride = 24

export function shadeDirection (value: GraphConfigInterface['pointDefaultStrokeColor']): number {
  if (value === 'darken') return -1
  if (value === 'lighten') return 1
  return 0
}

function outlineColor (value: GraphConfigInterface['pointDefaultStrokeColor']): Rgba {
  if (value === 'auto' || value === 'lighten' || value === 'darken') return deriveColor
  return getRgbaColor(value)
}

function copyColor (dest: Float32Array, offset: number, value: Float32Array | undefined, index: number, fallback: Rgba): void {
  const start = index * 4
  if (value && Number.isFinite(value[start]) && Number.isFinite(value[start + 1]) &&
      Number.isFinite(value[start + 2]) && Number.isFinite(value[start + 3])) {
    for (let channel = 0; channel < 4; channel++) dest[offset + channel] = value[start + channel] as number
  } else {
    dest.set(fallback, offset)
  }
}

export class Points {
  public atlas?: Texture
  private images?: ImageData[]
  private atlasCoords?: Float32Array

  public constructor (private readonly device: Device) {}

  public pack (data: GraphData, config: GraphConfigInterface, background: Rgba): {
    attributes: Float32Array;
    mask: PointHighlightMask;
    order: Uint32Array;
    colors: Float32Array;
    greyExitColor: Rgba;
  } {
    const pointCount = data.pointsNumber ?? 0
    const [r, g, b] = background
    const grey = rgbToBrightness(r, g, b) < 0.65 ? 0.2 : 0.8
    const mask = new PointHighlightMask(pointCount, config.highlightedPointIndices)
    const outlined = new Set(config.outlinedPointIndices ?? [])
    const greyColor = config.pointGreyoutColor && getRgbaColor(config.pointGreyoutColor)
    const greyExitColor: Rgba = greyColor || [
      (grey < 0.5 ? grey : Math.max(r, grey)) * 0.65,
      (grey < 0.5 ? grey : Math.max(g, grey)) * 0.65,
      (grey < 0.5 ? grey : Math.max(b, grey)) * 0.65, 0,
    ]
    const stroke = outlineColor(config.pointDefaultStrokeColor)
    const ring = outlineColor(config.outlinedPointRingColor)

    const attributes = new Float32Array(pointCount * pointStride)
    // Resolve both paints once, with the same double-to-Float32 rounding as the
    // style upload. Uniform point colors share one pair even on million-point graphs.
    let colors = new Float32Array(8)
    const pair = new Float32Array(8)
    for (let i = 0; i < pointCount; i++) {
      const at = i * pointStride
      const isGreyed = mask.isGreyed(i)
      let isUniform = colors.length === 8
      // Keep the present values for drawing through an exit. Only default channels
      // follow presence. An explicit size or color remains visible until the slot is gone.
      let defaultChannels = 0
      for (let ch = 0; ch < 4; ch++) {
        const raw = data.pointColors?.[i * 4 + ch]
        const fromDefault = !isNumber(raw)
        if (fromDefault) defaultChannels |= 1 << ch
        const value = fromDefault ? data.defaultRgba[ch]! : raw!
        pair[ch] = value
        let dim = value
        if (greyColor) dim = greyColor[ch] as number
        else if (ch < 3) dim = value * 0.35 + greyExitColor[ch]!
        pair[4 + ch] = dim
        attributes[at + ch] = pair[(isGreyed ? 4 : 0) + ch]!
        isUniform &&= colors[ch] === pair[ch] && colors[4 + ch] === pair[4 + ch]
      }
      if (i === 0) colors.set(pair)
      else if (!isUniform) {
        if (colors.length === 8) {
          const first = colors
          colors = new Float32Array(pointCount * 8)
          for (let j = 0; j < i; j++) colors.set(first, j * 8)
        }
        colors.set(pair, i * 8)
      }
      const imageIndex = data.pointImageIndices?.[i] ?? -1
      const imageValid = imageIndex >= 0 && imageIndex < (this.images?.length ?? 0) && this.atlasCoords
      const size = data.pointSizes?.[i]
      if (isNumber(size)) attributes[at + 4] = size!
      else {
        attributes[at + 4] = config.pointDefaultSize
        defaultChannels |= 16
      }
      attributes[at + 5] = data.pointShapes?.[i] ?? Number(config.pointDefaultShape)
      const width = data.pointStrokeWidths?.[i]
      attributes[at + 6] = Number.isFinite(width) ? width as number : config.pointDefaultStrokeWidth
      attributes[at + 7] = imageValid ? data.pointImageSizes?.[i] ?? 0 : 0
      copyColor(attributes, at + 8, data.pointStrokeColors, i, stroke)
      if (outlined.has(i)) copyColor(attributes, at + 12, data.inputPointRingColors, i, ring)
      else attributes.set(noColor, at + 12)
      attributes[at + 16] = isGreyed ? config.pointGreyoutOpacity ?? config.pointOpacity : config.pointOpacity
      attributes[at + 17] = Number(isGreyed)
      attributes[at + 18] = grey
      attributes[at + 19] = defaultChannels
      if (imageValid && this.atlasCoords) {
        const start = imageIndex * 4
        for (let ch = 0; ch < 4; ch++) attributes[at + 20 + ch] = this.atlasCoords[start + ch] as number
      }
    }
    return { attributes, mask, order: mask.drawOrder(data.pointRenderOrder), colors, greyExitColor }
  }

  public destroy (): void {
    this.atlas?.destroy()
  }

  public updateAtlas (images: ImageData[] | undefined): void {
    if (images === this.images && this.atlas) return
    const packed = images?.length ? createAtlasDataFromImageData(images, this.device.limits.maxTextureDimension2D) : undefined
    const size = packed?.atlasSize ?? 1
    const atlas = this.device.createTexture({
      id: 'cosmos-image-atlas',
      width: size,
      height: size,
      format: 'rgba8unorm',
      sampler: { minFilter: 'linear', magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' },
    })
    try {
      atlas.copyImageData({ data: packed?.atlasData ?? new Uint8Array(4), bytesPerRow: size * 4 })
    } catch (e) {
      atlas.destroy()
      throw e
    }
    this.atlas?.destroy()
    this.atlas = atlas
    this.atlasCoords = packed?.atlasCoords
    this.images = images
  }
}
