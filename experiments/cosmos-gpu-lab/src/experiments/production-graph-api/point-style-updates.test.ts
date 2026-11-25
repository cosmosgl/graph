import { expect, it } from 'vitest'
import { comparePixels } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { runPointStyleUpdates } from './point-style-updates'

async function digest (image: ImageData): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', image.data))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

it.each([1, 2] as const)('draws and picks point-only color and size edits around an interruption at %i×', async ratio => {
  const gl = await runPointStyleUpdates('webgl', ratio)
  const gpu = await runPointStyleUpdates('webgpu', ratio)
  const rows = await Promise.all(gl.samples.map(async ({ pixels, ...webgl }, i) => {
    const { pixels: other, ...webgpu } = gpu.samples[i]!
    let outsideEditedPoint = 0
    // Include the antialiasing fringe of the larger displayed circle. Both links and
    // the control points lie in the rest of the canvas, where all pixels must agree.
    const radius = Math.max(webgl.size, webgpu.size) / 2 + 1 / ratio
    const comparison = comparePixels(pixels, other, undefined, pixel => {
      const x = (pixel % pixels.width + 0.5) / ratio
      const y = (Math.floor(pixel / pixels.width) + 0.5) / ratio
      if (Math.hypot(x - 48, y - 48) > radius) outsideEditedPoint++
    })
    const [webglSha256, webgpuSha256] = await Promise.all([digest(pixels), digest(other)])
    return { webgl, webgpu, webglSha256, webgpuSha256, outsideEditedPoint, ...comparison }
  }))
  await writeArtifact(`package-point-style-updates-${ratio}x`, { ratio, devices: [gl.deviceInfo, gpu.deviceInfo], rows })
  if (import.meta.env.LAB_NATIVE_GPU) {
    expect(gl.deviceInfo.gpuType).not.toBe('cpu')
    expect(gpu.deviceInfo.fallback).toBe(false)
  }
  const red = [255, 0, 0]; const blue = [0, 0, 255]; const purple = [128, 0, 128]; const white = [255, 255, 255]
  const expectedColors = {
    webgl: [red, blue, blue, blue, purple, red, [255, 128, 128], white],
    webgpu: [red, blue, blue, blue, purple, purple, [191, 128, 191], white],
  }
  const expectedSizes = { webgl: [8, 8, 40, 40, 24, 8, 24, 40], webgpu: [8, 8, 40, 40, 24, 24, 32, 40] }
  expect(rows).toHaveLength(8)
  for (const [i, row] of rows.entries()) {
    expect(row.webgpu.phase).toBe(row.webgl.phase)
    // The edge is 20 CSS pixels from the edited point's center.
    const edge = [2, 5, 6, 7].includes(i) ? 'Point 0' : 'Background'
    for (const engine of ['webgl', 'webgpu'] as const) {
      const sample = row[engine]
      const label = `${engine} · ${sample.phase}`
      expect.soft(sample.size, label).toBe(expectedSizes[engine][i])
      expect.soft(sample.pointSpan, label).toBe(sample.size * ratio)
      expect.soft(sample.pointRgb, label).toEqual(expectedColors[engine][i])
      // WebGL suspends pointer updates during size transitions and reuses the last hit (the control point).
      // The existing WebGPU pointer path picks the target size throughout the transition.
      const held = engine === 'webgl' && i >= 3 && i <= 6
      expect.soft(sample.picks, label).toEqual(held
        ? { center: 'Point 2', edge: 'Point 2', link: 'Point 2', control: 'Point 2' }
        : { center: 'Point 0', edge, link: 'Link 0', control: 'Point 2' })
      // The gradient reads its current endpoint colors even while the point paint interpolates.
      const endpoint = [red, blue, blue, red, red, white, white, white][i]!
      const green = [0, 255, 0]
      for (const [channel, value] of sample.linkRgb.entries()) {
        expect.soft(Math.abs(value - (endpoint[channel]! + green[channel]!) / 2), label).toBeLessThanOrEqual(2)
      }
    }
    expect.soft(row.outsideEditedPoint, row.webgl.phase).toBe(0)
    // WebGL restarts at the previous target. WebGPU continues from the size and color it last displayed.
    if (i === 5 || i === 6) expect.soft(row.differingPixels).toBeGreaterThan(0)
    else if (i === 4) expect.soft(row.maxChannelDelta, row.webgl.phase).toBeLessThanOrEqual(1)
    else expect.soft(row.differingPixels, row.webgl.phase).toBe(0)
  }
})
