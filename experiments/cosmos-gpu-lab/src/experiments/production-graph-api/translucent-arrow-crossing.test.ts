import { expect, it } from 'vitest'
import { comparePixels } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { arrowProbes, runArrowCrossing } from './translucent-arrow-crossing'

const black = [0, 0, 0]
const red = [128, 0, 0]
const green = [0, 128, 0]
const redOverGreen = [128, 64, 0]
const greenOverRed = [64, 128, 0]
const hit0 = 'Link 0'; const hit1 = 'Link 1'; const empty = 'Background'

// The first probe is outside both 8 px shafts and inside both arrowheads.
const expected = [
  { name: 'Red over green', rgb: [redOverGreen, redOverGreen, red, green, black], picks: [hit1, hit1, hit1, hit0, empty] },
  { name: 'Green over red', rgb: [greenOverRed, greenOverRed, red, green, black], picks: [hit1, hit1, hit0, hit1, empty] },
  { name: 'Red alone', rgb: [red, red, red, black, black], picks: [hit0, hit0, hit0, empty, empty] },
  { name: 'Green alone', rgb: [green, green, black, green, black], picks: [hit0, hit0, empty, hit0, empty] },
  { name: 'Both arrows off', rgb: [black, redOverGreen, red, green, black], picks: [empty, hit1, hit1, hit0, empty] },
]

type Frames = Awaited<ReturnType<typeof runArrowCrossing>>['frames']
function checkCompositing (frames: Frames): { pixelsChangedByOrder: number; outsideOverlap: number; maxBlendError: number } {
  const image = (name: Frames[number]['name']): ImageData => frames.find(frame => frame.name === name)!.pixels
  const redTop = image('Red over green'); const greenTop = image('Green over red')
  const redOnly = image('Red alone'); const greenOnly = image('Green alone')
  let outsideOverlap = 0
  const reversal = comparePixels(redTop, greenTop, undefined, i => {
    if (!redOnly.data[4 * i] || !greenOnly.data[4 * i + 1]) outsideOverlap++
  })
  let maxBlendError = 0
  for (let i = 0; i < redOnly.data.length; i += 4) {
    // Over black, each isolated channel measures the link's effective alpha, including edge coverage.
    const r = redOnly.data[i]!; const g = greenOnly.data[i + 1]!
    maxBlendError = Math.max(maxBlendError,
      Math.abs(redTop.data[i]! - r), Math.abs(redTop.data[i + 1]! - Math.round(g * (1 - r / 255))),
      Math.abs(greenTop.data[i]! - Math.round(r * (1 - g / 255))), Math.abs(greenTop.data[i + 1]! - g))
  }
  return { pixelsChangedByOrder: reversal.differingPixels, outsideOverlap, maxBlendError }
}

it.each([1, 2] as const)('composites overlapping translucent arrowheads and picks the top link at %i×', async ratio => {
  const gl = await runArrowCrossing('webgl', ratio)
  const gpu = await runArrowCrossing('webgpu', ratio)
  const comparisons = gl.frames.map(({ name, sites: webgl, pixels }, i) => ({
    name, webgl, webgpu: gpu.frames[i]!.sites, frame: comparePixels(pixels, gpu.frames[i]!.pixels),
  }))
  const blend = { webgl: checkCompositing(gl.frames), webgpu: checkCompositing(gpu.frames) }
  await writeArtifact(`package-translucent-arrow-crossing-${ratio}x`, { ratio, devices: [gl.device, gpu.device], probes: arrowProbes, comparisons, blend })
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(gl.device.gpuType).not.toBe('cpu'); expect(gpu.device.fallback).toBe(false)
  } else {
    expect(gl.device.renderer).toMatch(/SwiftShader/i); expect(gpu.device.gpuArchitecture).toBe('swiftshader')
  }
  for (const [i, sample] of comparisons.entries()) {
    const control = expected[i]!
    expect(sample.name).toBe(control.name)
    for (const sites of [sample.webgl, sample.webgpu]) {
      expect.soft(sites.map(site => site.rgb), sample.name).toEqual(control.rgb)
      expect.soft(sites.map(site => site.pick), sample.name).toEqual(control.picks)
    }
    expect.soft(sample.frame.maxChannelDelta, sample.name).toBeLessThanOrEqual(1)
  }
  for (const result of Object.values(blend)) {
    expect(result.pixelsChangedByOrder).toBeGreaterThan((8 * ratio) ** 2)
    expect(result.outsideOverlap).toBe(0)
    expect(result.maxBlendError).toBeLessThanOrEqual(1)
  }
})
