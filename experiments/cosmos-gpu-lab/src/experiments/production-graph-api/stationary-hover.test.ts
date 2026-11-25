import { expect, it } from 'vitest'
import { comparePixels } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { runStationaryHover } from './stationary-hover'

it.each([1, 2] as const)('updates the hover ring and callbacks under a parked cursor at %i×', async ratio => {
  const gl = await runStationaryHover('webgl', ratio)
  const gpu = await runStationaryHover('webgpu', ratio)
  const comparisons = gl.samples.map(({ pixels, ...webgl }, i) => {
    const { pixels: other, ...webgpu } = gpu.samples[i]!
    return { webgl, webgpu, ...comparePixels(pixels, other) }
  })
  await writeArtifact(`package-stationary-hover-${ratio}x`, { devices: [gl.deviceInfo, gpu.deviceInfo], ratio, comparisons })
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(gl.deviceInfo.gpuType).not.toBe('cpu')
    expect(gpu.deviceInfo.fallback).toBe(false)
  }
  // A direct point-to-point handoff announces the new ID. Out fires when the cursor stops covering a point.
  const events = ['over 0', 'over 1', 'out 1', 'over 1', 'out 1', 'over 1', 'out 1']
  const eventCounts = [0, 1, 1, 2, 3, 4, 5, 6, 7]
  const ringVisible = [false, true, true, true, false, true, false, true, false]
  expect(comparisons).toHaveLength(eventCounts.length)
  for (const [i, row] of comparisons.entries()) {
    expect(row.webgpu.phase).toBe(row.webgl.phase)
    for (const sample of [row.webgl, row.webgpu]) {
      expect.soft(sample.events, sample.phase).toEqual(events.slice(0, eventCounts[i]))
      expect.soft(sample.mouseMoves, sample.phase).toBe(1)
      expect.soft(sample.ringPixels > 10 * ratio * ratio, sample.phase).toBe(ringVisible[i])
      expect.soft(sample.ringPixelsAtCursor, sample.phase).toBe(sample.ringPixels)
    }
    expect.soft(row.differingPixels, `${row.webgl.phase}, largest channel difference ${row.maxChannelDelta}/255`).toBe(0)
  }
})
