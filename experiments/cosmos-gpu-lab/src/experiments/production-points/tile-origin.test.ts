import type { DeviceInfo } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { comparePixels } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import type { Engine } from '../production-graph-api/frame'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import { pointBackground, pointFill, pointsConfig } from './fixture'

// A 32 CSS-pixel circle. Its left or lower edge sits on a 32-device-pixel tile
// boundary for the first three centers (both axes, y only, x only), at both ratios.
const centers = [[48, 48], [116, 48], [48, 116], [116, 116]] as const
const viewport = 160

async function renderCircles (engine: Engine, ratio: 1 | 2): Promise<{ image: ImageData; device: DeviceInfo; wrongPixels: number[] }> {
  const frame = document.createElement('iframe')
  frame.style.cssText = `width:${viewport}px;height:${viewport}px;border:0`
  document.body.append(frame)
  try {
    const doc = frame.contentDocument!
    doc.body.style.margin = '0'
    const host = doc.createElement('div')
    host.style.cssText = 'position:relative;width:100vw;height:100vh'
    doc.body.append(host)
    const GRAPH = await loadGraphPackage(engine, doc)
    const graph = new GRAPH(host, { ...pointsConfig, pixelRatio: ratio, pointDefaultSize: 32 })
    try {
      await graph.ready
      const device = graph.simulation.device?.info
      if (device?.type !== engine) throw new Error(`Requested ${engine} but got ${device?.type}`)
      const origin = pointsConfig.spaceSize / 2
      graph.setPointPositions(Float32Array.from(centers.flatMap(([x, y]) => [origin + x - viewport / 2, origin - y + viewport / 2])), true)
      graph.render(undefined, 0)
      graph.pause()
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [viewport, viewport])
      const copy = doc.createElement('canvas')
      copy.width = copy.height = viewport * ratio
      const ctx = copy.getContext('2d', { willReadFrequently: true })!
      graph.renderOneFrame()
      ctx.drawImage(host.querySelector('canvas')!, 0, 0)
      const image = ctx.getImageData(0, 0, copy.width, copy.height)
      const wrongPixels = centers.map(([cx, cy]) => {
        let wrong = 0
        for (let y = (cy - 16) * ratio; y < (cy + 16) * ratio; y++) {
          for (let x = (cx - 16) * ratio; x < (cx + 16) * ratio; x++) {
            const distance = Math.hypot(x + 0.5 - cx * ratio, y + 0.5 - cy * ratio) - 16 * ratio
            if (Math.abs(distance) <= 1) continue
            const expected = distance < 0 ? pointFill : pointBackground
            if (expected.some((channel, i) => image.data[4 * (y * image.width + x) + i] !== channel)) wrong++
          }
        }
        return wrong
      })
      return { image, device, wrongPixels }
    } finally { graph.destroy() }
  } finally { frame.remove() }
}

it.each([1, 2] as const)('keeps circles round when their sprite begins on a raster tile at %i×', async ratio => {
  const gl = await renderCircles('webgl', ratio)
  const gpu = await renderCircles('webgpu', ratio)
  const comparison = comparePixels(gl.image, gpu.image)
  await writeArtifact(`point-style-tile-origin-${ratio}x`, {
    ratio, centers, comparison, devices: [gl.device, gpu.device], webgl: gl.wrongPixels, webgpu: gpu.wrongPixels,
  })
  expect(gl.wrongPixels).toEqual([0, 0, 0, 0])
  expect(gpu.wrongPixels).toEqual(gl.wrongPixels)
  expect(comparison.differingPixels).toBe(0)
})
