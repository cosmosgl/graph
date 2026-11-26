import { Buffer, type Device, type Texture } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import type { GraphConfigInterface } from '@/graph/config'
import { getRgbaColor, isNumber, rgbToBrightness } from '@/graph/helper'
import type { GraphData } from '@/graph/modules/GraphData'
import { createAtlasDataFromImageData } from '@/graph/modules/Points/atlas-utils'
import records from '../../style-records.wgsl?raw'
import { PointHighlightMask } from './highlights'
import updateStyles from './update-styles.wgsl?raw'

type Rgba = [number, number, number, number]
const noColor: Rgba = [0, 0, 0, -1]
const deriveColor: Rgba = [0, 0, 0, -2]
export const pointStride = 24
export type PointChannels = { colors: boolean; sizes: boolean }

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

// The same unhighlighted color feeds both animation endpoints. Missing input
// channels follow the transparent exit default when a point is removed.
function writeFill (data: GraphData, index: number, target: Float32Array, offset: number): number {
  let defaults = 0
  for (let channel = 0; channel < 4; channel++) {
    const value = data.pointColors?.[index * 4 + channel]
    if (isNumber(value)) target[offset + channel] = value!
    else {
      target[offset + channel] = data.defaultRgba[channel]!
      defaults |= 1 << channel
    }
  }
  return defaults
}

export class Points {
  public atlas?: Texture
  private styleKernel?: Kernel
  private images?: ImageData[]
  private atlasCoords?: Float32Array

  public constructor (private readonly device: Device) {}

  public pack (data: GraphData, config: GraphConfigInterface, background: Rgba): {
    attributes: Float32Array;
    mask: PointHighlightMask;
    order: Uint32Array;
    greyExitColor: Rgba;
  } {
    const pointCount = data.pointsNumber ?? 0
    const [r, g, b] = background
    const grey = rgbToBrightness(r, g, b) < 0.65 ? 0.2 : 0.8
    const mask = new PointHighlightMask(pointCount, config.highlightedPointIndices)
    const outlined = new Set(config.outlinedPointIndices ?? [])
    const greyColor = config.pointGreyoutColor ? getRgbaColor(config.pointGreyoutColor) : undefined
    const greyExitColor: Rgba = greyColor || [
      (grey < 0.5 ? grey : Math.max(r, grey)) * 0.65,
      (grey < 0.5 ? grey : Math.max(g, grey)) * 0.65,
      (grey < 0.5 ? grey : Math.max(b, grey)) * 0.65, 0,
    ]
    const stroke = outlineColor(config.pointDefaultStrokeColor)
    const ring = outlineColor(config.outlinedPointRingColor)

    const attributes = new Float32Array(pointCount * pointStride)
    for (let i = 0; i < pointCount; i++) {
      const at = i * pointStride
      attributes[at + 19] = writeFill(data, i, attributes, at)
      const isGreyed = mask.isGreyed(i)
      const imageIndex = data.pointImageIndices?.[i] ?? -1
      const imageValid = this.hasImage(imageIndex)
      const size = data.pointSizes?.[i]
      const defaultSize = !isNumber(size)
      attributes[at + 4] = defaultSize ? config.pointDefaultSize : size!
      if (defaultSize) attributes[at + 19]! += 16
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
      if (imageValid && this.atlasCoords) {
        const start = imageIndex * 4
        for (let ch = 0; ch < 4; ch++) attributes[at + 20 + ch] = this.atlasCoords[start + ch] as number
      }
    }
    return { attributes, mask, order: mask.drawOrder(data.pointRenderOrder), greyExitColor }
  }

  /** Update the changed lanes of the same records used by canvas, host, link gradients and picking. */
  public updateStyles (
    target: Buffer, data: GraphData, config: GraphConfigInterface, channels: PointChannels, snapshot: boolean
  ): Buffer | undefined {
    const count = data.pointsNumber ?? 0
    const colorFields = channels.colors ? 5 : 0 // RGBA and the per-channel default mask
    const stride = colorFields + (channels.sizes ? 3 : 0) // diameter, image diameter, default-size bit
    const edits = new Float32Array(2 + count * stride)
    edits[0] = colorFields
    edits[1] = stride
    if (channels.colors) {
      for (let i = 0; i < count; i++) {
        const at = 2 + i * stride
        edits[at + 4] = writeFill(data, i, edits, at)
      }
    }
    if (channels.sizes) {
      for (let i = 0; i < count; i++) {
        const at = 2 + i * stride + colorFields
        const size = data.pointSizes?.[i]
        const fromDefault = !isNumber(size)
        edits[at] = fromDefault ? config.pointDefaultSize : size!
        edits[at + 1] = this.hasImage(data.pointImageIndices?.[i] ?? -1) ? data.pointImageSizes?.[i] ?? 0 : 0
        edits[at + 2] = fromDefault ? 16 : 0
      }
    }
    this.styleKernel ??= new Kernel(this.device, {
      id: 'cosmos-update-point-styles',
      source: records + updateStyles,
      shaderLayout: {
        bindings: [
          { name: 'points', type: 'storage', group: 0, location: 0 },
          { name: 'edits', type: 'read-only-storage', group: 0, location: 1 },
        ],
      },
    })
    const encoder = this.device.createCommandEncoder()
    let previous: Buffer | undefined
    let input: Buffer | undefined
    try {
      if (snapshot) {
        const size = count * pointStride * Float32Array.BYTES_PER_ELEMENT
        previous = this.device.createBuffer({ byteLength: size, usage: Buffer.STORAGE | Buffer.COPY_DST })
        encoder.copyBufferToBuffer({ sourceBuffer: target, destinationBuffer: previous, size })
      }
      input = this.device.createBuffer({ id: 'cosmos-point-style-edits', data: edits, usage: Buffer.STORAGE })
      const groups = Math.ceil(count / 64)
      const x = Math.min(groups, this.device.limits.maxComputeWorkgroupsPerDimension)
      const pass = encoder.beginComputePass({})
      try {
        this.styleKernel.dispatch(pass, { x, y: Math.ceil(groups / x), bindings: { points: target, edits: input } })
      } finally { pass.end() }
      this.device.submit(encoder.finish())
      return previous
    } catch (error) {
      previous?.destroy()
      throw error
    } finally { input?.destroy(); encoder.destroy() }
  }

  public destroy (): void {
    this.styleKernel?.destroy()
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

  private hasImage (index: number): boolean {
    return index >= 0 && index < (this.images?.length ?? 0) && !!this.atlasCoords
  }
}
