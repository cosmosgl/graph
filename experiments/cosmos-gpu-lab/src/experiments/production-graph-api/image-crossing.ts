import type { DeviceInfo } from '@luma.gl/core'
import { replayCurve, type CrossingSample } from './curved-crossing'
import type { Engine } from './frame'

export const imageAreas = [
  { key: 'opaque', x: 104, y: 82, alpha: 255 },
  { key: 'translucent', x: 128, y: 80, alpha: 128 },
  { key: 'transparent', x: 152, y: 82, alpha: 0 },
] as const
export const imageProbes = [...imageAreas, { key: 'edge', x: 174, y: 80, alpha: 0 }] as const
type Probe = typeof imageProbes[number]['key']
type Site = { pick: string; rgb: number[] }
type AreaSamples = Record<Probe, Site & { linkOnlyPick: string; linkOnlyRgb: number[] }>
type ImageSample = Pick<CrossingSample, 'phase' | 'time' | 'pixels'> & { areas: AreaSamples; linkOnlyPixels: ImageData }

function bandImage (): ImageData {
  // A 24 px tall strip leaves visible space between the image and the curve before and after the crossing.
  const image = new ImageData(96, 96)
  for (let y = 36; y < 60; y++) {
    for (let x = 0; x < image.width; x++) {
      const offset = 4 * (y * image.width + x)
      image.data[offset] = 255
      image.data[offset + 3] = imageAreas[Math.floor(x / 32)]!.alpha
    }
  }
  return image
}

export function runImageCrossing (engine: Engine, ratio: 1 | 2): Promise<{ deviceInfo: DeviceInfo; samples: ImageSample[] }> {
  return replayCurve<{ pixels: ImageData; sites: Record<Probe, Site> }, ImageSample>(engine, ratio, {
    configurePoint (graph) {
      // Point 2 keeps its red color but has no painted shape underneath the image.
      graph.setPointShapes(Float32Array.of(0, 0, 8)) // Circle, Circle, None
      graph.setPointSizes(Float32Array.of(6, 6, 0))
      graph.setImageData([bandImage()])
      graph.setPointImageIndices(Float32Array.of(-1, -1, 0))
      graph.setPointImageSizes(Float32Array.of(0, 0, 96))
    },
    async control ({ pixels, click, rgb }) {
      const sites = {} as Record<Probe, Site>
      for (const { key, x, y } of imageProbes) sites[key] = { pick: await click(x, y), rgb: rgb(x, y) }
      return { pixels, sites }
    },
    async sample ({ phase, time, pixels, rgb, click }, linkOnly) {
      const areas = {} as AreaSamples
      for (const { key, x, y } of imageProbes) {
        areas[key] = { pick: await click(x, y), rgb: rgb(x, y), linkOnlyPick: linkOnly.sites[key].pick, linkOnlyRgb: linkOnly.sites[key].rgb }
      }
      return { phase, time, pixels, areas, linkOnlyPixels: linkOnly.pixels }
    },
  })
}
