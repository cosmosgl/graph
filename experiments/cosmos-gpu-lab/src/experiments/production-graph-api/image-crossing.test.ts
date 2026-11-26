import { expect, it } from 'vitest'
import { comparePixels } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { imageAreas, imageProbes, runImageCrossing } from './image-crossing'

type Sample = Awaited<ReturnType<typeof runImageCrossing>>['samples'][number]

function measureImage (sample: Sample, ratio: number): {
  redInkBounds: number[];
  changesOutsideImage: number;
  exposedStroke: number[];
  exposedControlStroke: number[];
} {
  const { pixels, linkOnlyPixels } = sample
  let changesOutsideImage = 0
  let left = pixels.width
  let top = pixels.height
  let right = -1
  let bottom = -1
  comparePixels(pixels, linkOnlyPixels, undefined, index => {
    const x = index % pixels.width
    const y = Math.floor(index / pixels.width)
    // The complete uploaded 96 px image is centered at (128,80). Outside it, both animations must agree.
    if (x < 80 * ratio || x >= 176 * ratio || y < 32 * ratio || y >= 128 * ratio) changesOutsideImage++
    if (pixels.data[4 * index]! > 0 && linkOnlyPixels.data[4 * index] === 0) {
      left = Math.min(left, x); right = Math.max(right, x)
      top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
  })
  // At x=56 the moving stroke is 10.5 CSS px above its endpoints, clear of the entire image.
  const strokeY = 62 + 64 * sample.time / 1000
  const offset = 4 * (strokeY * ratio * pixels.width + 56 * ratio)
  return {
    redInkBounds: right < left ? [] : [left, top, right + 1, bottom + 1],
    changesOutsideImage,
    exposedStroke: Array.from(pixels.data.subarray(offset, offset + 3)),
    exposedControlStroke: Array.from(linkOnlyPixels.data.subarray(offset, offset + 3)),
  }
}

it.each([1, 2] as const)('draws a curved link behind opaque, translucent and transparent point-image texels at %i×', async ratio => {
  const gl = await runImageCrossing('webgl', ratio)
  const gpu = await runImageCrossing('webgpu', ratio)
  const nativeM3 = gl.deviceInfo.renderer.includes('Apple M3') && gpu.deviceInfo.gpuArchitecture === 'metal-3'
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(gl.deviceInfo.gpuType).not.toBe('cpu')
    expect(gpu.deviceInfo.fallback).toBe(false)
  }
  const comparisons = gl.samples.map((a, i) => {
    const b = gpu.samples[i]!
    expect([a.phase, a.time]).toEqual([b.phase, b.time])
    let redDifferences = 0
    let greenDifferences = 0
    let otherChannelDifferences = 0
    let differencesOffControlEdges = 0
    const fullFrame = comparePixels(a.pixels, b.pixels, undefined, index => {
      const offset = 4 * index
      if (a.pixels.data[offset] !== b.pixels.data[offset]) redDifferences++
      if (a.pixels.data[offset + 1] !== b.pixels.data[offset + 1]) greenDifferences++
      if (a.pixels.data[offset + 2] !== b.pixels.data[offset + 2] || a.pixels.data[offset + 3] !== b.pixels.data[offset + 3]) otherChannelDifferences++
      if (a.linkOnlyPixels.data[offset + 1] === b.linkOnlyPixels.data[offset + 1]) differencesOffControlEdges++
    })
    const webglImage = measureImage(a, ratio)
    const webgpuImage = measureImage(b, ratio)
    return {
      phase: a.phase,
      time: a.time,
      webgl: a.areas,
      webgpu: b.areas,
      webglImage,
      webgpuImage,
      fullFrame,
      redDifferences,
      greenDifferences,
      otherChannelDifferences,
      differencesOffControlEdges,
      linkOnlyFrame: comparePixels(a.linkOnlyPixels, b.linkOnlyPixels),
      translucentPaintMatchesReference: a.areas.translucent.rgb.every((channel, c) => channel === b.areas.translucent.rgb[c]),
      imageBoundsMatchReference: webglImage.redInkBounds.length === 4 && webgpuImage.redInkBounds.length === 4 &&
        webglImage.redInkBounds.every((v, c) => v === webgpuImage.redInkBounds[c]),
    }
  })
  await writeArtifact(`package-image-crossing-${ratio}x`, {
    devices: [gl.deviceInfo, gpu.deviceInfo],
    ratio,
    imageAreas,
    imageProbes,
    comparisons,
    translucentPaintMatchesReference: comparisons.every(frame => frame.translucentPaintMatchesReference),
    imageBoundsMatchReference: comparisons.every(frame => frame.imageBoundsMatchReference),
  })
  expect(comparisons.map(({ phase, time }) => [phase, time])).toEqual([['before', 0], ['during', 500], ['after', 1000]])
  for (const row of comparisons) {
    const crossing = row.phase === 'during'
    for (const { key } of imageProbes) {
      for (const areas of [row.webgl, row.webgpu]) {
        expect.soft(areas[key].pick, row.phase).toBe('Point 2')
        expect.soft(areas[key].linkOnlyPick, row.phase).toBe(crossing ? 'Link 0' : 'Background')
        // At x=174 only the link's padded pick target reaches y=80.
        expect.soft(areas[key].linkOnlyRgb, row.phase).toEqual(crossing && key !== 'edge' ? [0, 255, 0] : [0, 0, 0])
      }
    }
    for (const areas of [row.webgl, row.webgpu]) {
      expect.soft(areas.opaque.rgb, row.phase).toEqual([255, 0, 0])
      expect.soft(areas.transparent.rgb, row.phase).toEqual(areas.transparent.linkOnlyRgb)
      expect.soft(areas.translucent.rgb, row.phase).toEqual([64, crossing ? 127 : 0, 0])
      expect.soft(areas.edge.rgb, row.phase).toEqual(areas.edge.linkOnlyRgb)
    }
    for (const image of [row.webglImage, row.webgpuImage]) {
      expect.soft(image.changesOutsideImage, row.phase).toBe(0)
      expect.soft(image.exposedStroke, row.phase).toEqual([0, 255, 0])
      expect.soft(image.exposedControlStroke, row.phase).toEqual([0, 255, 0])
    }
    expect.soft(row.webgpu, row.phase).toEqual(row.webgl)
    expect.soft(row.translucentPaintMatchesReference, row.phase).toBe(true)
    expect.soft(row.imageBoundsMatchReference, row.phase).toBe(true)
    if (nativeM3) {
      const requested = [80, 68, 144, 92].map(css => css * ratio)
      expect.soft(row.webglImage.redInkBounds, row.phase).toEqual(requested)
      expect.soft(row.redDifferences, row.phase).toBe(0)
      expect.soft(row.otherChannelDifferences, row.phase).toBe(0)
      expect.soft(row.differencesOffControlEdges, row.phase).toBe(0)
      expect.soft(row.fullFrame.maxChannelDelta, row.phase).toBeLessThanOrEqual(ratio === 1 ? 1 : 0)
    }
  }
})
