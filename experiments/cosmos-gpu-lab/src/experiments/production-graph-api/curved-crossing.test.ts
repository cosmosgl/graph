import { expect, it } from 'vitest'
import { comparePixels } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { runCurvedCrossing, type CrossingSample } from './curved-crossing'

function measureCrossing (sample: CrossingSample, ratio: number): {
  picks: CrossingSample['picks'];
  colors: CrossingSample['colors'];
  linkOnly: { pick: string; rgb: number[] };
  coveredStrokePixels: number;
  changedOutsidePoint: number;
} {
  const { pixels, linkOnly, colors, picks } = sample
  const solidGreen = [0, 255, 0, 255]
  const solidRed = [255, 0, 0, 255]
  let coveredStrokePixels = 0
  let changedOutsidePoint = 0
  comparePixels(linkOnly.pixels, pixels, undefined, index => {
    const x = index % pixels.width
    const y = Math.floor(index / pixels.width)
    if (x < 116 * ratio || x >= 140 * ratio || y < 68 * ratio || y >= 92 * ratio) changedOutsidePoint++
    const offset = index * 4
    // Count fully green stroke pixels that turned fully red when point 2 was added.
    if (solidGreen.every((v, c) => v === linkOnly.pixels.data[offset + c]) &&
      solidRed.every((v, c) => v === pixels.data[offset + c])) coveredStrokePixels++
  })
  return { picks, colors, linkOnly: { pick: linkOnly.pick, rgb: linkOnly.rgb }, coveredStrokePixels, changedOutsidePoint }
}

it.each([1, 2] as const)('draws and picks a point in front of a moving solid curve at %i×', async ratio => {
  const gl = await runCurvedCrossing('webgl', ratio)
  const gpu = await runCurvedCrossing('webgpu', ratio)
  const devices = [gl.deviceInfo, gpu.deviceInfo]
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(gl.deviceInfo.gpuType).not.toBe('cpu')
    expect(gpu.deviceInfo.fallback).toBe(false)
  }
  const comparisons = gl.samples.map((sample, i) => {
    const other = gpu.samples[i]!
    expect([other.phase, other.time]).toEqual([sample.phase, sample.time])
    // Full-frame equality is reported for every draw. Classify each differing pixel
    // against the no-point control so a new error in the overlap cannot hide in an edge-count budget.
    let differencesIntroducedByPoint = 0
    let differencesOutsideStrokeEdges = 0
    const examples: { x: number; y: number; webgl: number[]; webgpu: number[] }[] = []
    const fullFrame = comparePixels(sample.pixels, other.pixels, undefined, index => {
      const offset = 4 * index
      const a = sample.pixels.data.subarray(offset, offset + 4)
      const b = other.pixels.data.subarray(offset, offset + 4)
      if (a.some((v, c) => v !== sample.linkOnly.pixels.data[offset + c]) ||
        b.some((v, c) => v !== other.linkOnly.pixels.data[offset + c])) differencesIntroducedByPoint++
      // The antialiased green stroke over black has fractional green and opaque alpha.
      const onlyGreen = [a, b].every(color => color[0] === 0 && color[2] === 0 && color[3] === 255)
      const partiallyCovered = [a, b].some(color => color[1]! > 0 && color[1]! < 255)
      if (!onlyGreen || !partiallyCovered) differencesOutsideStrokeEdges++
      if (examples.length < 12) examples.push({ x: index % sample.pixels.width, y: Math.floor(index / sample.pixels.width), webgl: [...a], webgpu: [...b] })
    })
    return {
      phase: sample.phase,
      time: sample.time,
      strokeY: sample.strokeY,
      fullFrame,
      differencesIntroducedByPoint,
      differencesOutsideStrokeEdges,
      examples,
      linkOnlyFrame: comparePixels(sample.linkOnly.pixels, other.linkOnly.pixels),
      webgl: measureCrossing(sample, ratio),
      webgpu: measureCrossing(other, ratio),
    }
  })
  await writeArtifact(`package-curved-crossing-${ratio}x`, { devices, ratio, comparisons })
  expect(comparisons.map(({ time }) => time)).toEqual([0, 500, 1000])
  const black = [0, 0, 0]
  const green = [0, 255, 0]
  const nativeM3 = gl.deviceInfo.renderer.includes('Apple M3') && gpu.deviceInfo.gpuArchitecture === 'metal-3'
  for (const row of comparisons) {
    const crossing = row.phase === 'during'
    for (const frame of [row.webgl, row.webgpu]) {
      expect.soft(frame.colors, row.phase).toEqual({ point: [255, 0, 0], witness: crossing ? green : black, stroke: green, background: black })
      expect.soft(frame.picks, row.phase).toEqual({ point: 'Point 2', witness: crossing ? 'Link 0' : 'Background', stroke: 'Link 0', background: 'Background' })
      expect.soft(frame.linkOnly, row.phase).toEqual({ pick: crossing ? 'Link 0' : 'Background', rgb: crossing ? green : black })
      expect.soft(frame.coveredStrokePixels > 0, row.phase).toBe(crossing)
      expect.soft(frame.changedOutsidePoint, row.phase).toBe(0)
    }
    expect.soft(row.differencesIntroducedByPoint, row.phase).toBe(0)
    expect.soft(row.differencesOutsideStrokeEdges, row.phase).toBe(0)
    expect.soft(row.webgl.coveredStrokePixels, row.phase).toBe(row.webgpu.coveredStrokePixels)
    if (nativeM3) {
      // Preserve the measured one-level edge agreement at 1× and byte equality at 2×.
      const maxDelta = ratio === 1 ? 1 : 0
      expect.soft(row.fullFrame.maxChannelDelta, row.phase).toBeLessThanOrEqual(maxDelta)
      expect.soft(row.linkOnlyFrame.maxChannelDelta, row.phase).toBeLessThanOrEqual(maxDelta)
    }
  }
})
