import { expect, it, vi } from 'vitest'
import { writeArtifact } from '../../testing/artifacts'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import type { Engine } from './frame'

type Paint = { pointRed: number; linkGreen: number }

async function replayAppend (engine: Engine, ratio: number): Promise<{ direct: Paint[]; staged: Paint[] }> {
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width:256px;height:256px;border:0'
  document.body.append(frame)
  try {
    const doc = frame.contentDocument!
    doc.body.style.margin = '0'
    const host = doc.createElement('div')
    host.style.cssText = 'position:relative;width:256px;height:256px'
    doc.body.append(host)
    const GRAPH = await loadGraphPackage(engine, doc)
    const graph = new GRAPH(host, {
      spaceSize: 256,
      pixelRatio: ratio,
      enableSimulation: false,
      enableRenderLoop: false,
      rescalePositions: false,
      fitViewOnInit: false,
      backgroundColor: '#000',
      pointDefaultSize: 24,
      pointDefaultColor: '#f00',
      linkDefaultColor: '#0f0',
      linkDefaultWidth: 4,
      linkVisibilityMinTransparency: 1,
    })
    try {
      await graph.ready
      const seed = (): void => {
        graph.setPointPositions(Float32Array.of(48, 208, 208, 208))
        graph.setPointSizes(Float32Array.of(24, 24))
        graph.setPointColors(Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1))
        graph.setLinks(Float32Array.of(0, 1))
        graph.render(undefined, 0)
      }
      const append = (absent: boolean): void => {
        graph.setPointPositions(Float32Array.of(48, 208, 208, 208, absent ? NaN : 48, absent ? NaN : 144))
        graph.setPointSizes(Float32Array.of(24, 24, absent ? NaN : 24))
        graph.setPointColors(Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, absent ? NaN : 1))
        graph.setLinks(Float32Array.of(0, 1, 0, 2))
        graph.render(undefined, 1000)
      }
      seed()
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [256, 256])
      const canvas = doc.querySelector('canvas')!
      const copy = doc.createElement('canvas')
      copy.width = copy.height = 256 * ratio
      const ctx = copy.getContext('2d', { willReadFrequently: true })!
      let now = 0
      const clock = vi.spyOn(frame.contentWindow!.performance, 'now').mockImplementation(() => now)
      const measure = (): Paint[] => {
        const start = now
        return [0, 500, 1000].map(time => {
          now = start + time
          graph.renderOneFrame()
          ctx.drawImage(canvas, 0, 0)
          // The red probe is inside the added point and outside its vertical green link.
          const pointRed = ctx.getImageData(52 * ratio, 112 * ratio, 1, 1).data[0]!
          const linkGreen = ctx.getImageData(48 * ratio, 80 * ratio, 1, 1).data[1]!
          return { pointRed, linkGreen }
        })
      }
      try {
        append(false)
        const direct = measure()
        seed()
        // The shared Add & Remove Points story makes these two renders in one event.
        append(true)
        append(false)
        return { direct, staged: measure() }
      } finally { clock.mockRestore() }
    } finally { graph.destroy() }
  } finally { frame.remove() }
}

it.each([1, 2])('uses the target for new slots and interpolates explicitly staged slots at %i×', async ratio => {
  const webgl = await replayAppend('webgl', ratio)
  const webgpu = await replayAppend('webgpu', ratio)
  await writeArtifact(`package-sparse-append-${ratio}x`, { ratio, webgl, webgpu })
  const full = { pointRed: 255, linkGreen: 255 }
  expect(webgl.direct).toEqual([full, full, full])
  expect(webgl.staged[0]).toEqual({ pointRed: 0, linkGreen: 0 })
  expect(webgl.staged[1]).toEqual({ pointRed: 191, linkGreen: 128 })
  expect(webgl.staged[2]).toEqual(full)
  expect(webgpu).toEqual(webgl)
})
