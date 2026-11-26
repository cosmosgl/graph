import type { DeviceInfo } from '@luma.gl/core'
import { expect, it } from 'vitest'
import { comparePixels } from '../../runtime/compare-pixels'
import { writeArtifact } from '../../testing/artifacts'
import { lineConfig, lineViewport } from '../production-lines/fixture'
import type { Engine } from './frame'
import { withLinkGraph } from './link-graph'

const scenes = [
  { links: [0, 1], hits: ['Point 0', 'Link 0', 'Background'] },
  { links: [2, 3], hits: ['Point 0', 'Background', 'Link 0'] },
  { links: [2, 3, 0, 1], hits: ['Point 0', 'Link 1', 'Link 0'] },
  { links: [], hits: ['Point 0', 'Background', 'Background'] },
]
const probes = [[64, 40], [128, 40], [128, 120]] as const

type TopologyFrame = { hits: string[]; rgb: number[][]; fullUpdate: number; pixels: ImageData }

function replay (engine: Engine, ratio: 1 | 2): Promise<{ device: DeviceInfo; frames: TopologyFrame[] }> {
  const config = { ...lineConfig('straight', ratio), backgroundColor: '#000', linkDefaultColor: '#00ff00', linkDefaultWidth: 8 }
  return withLinkGraph(engine, ratio, config, async ({ graph, deviceInfo, capture, click }) => {
    const colors = Float32Array.from([1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1])
    graph.setPointPositions(Float32Array.of(192, 296, 320, 296, 192, 216, 320, 216), true)
    graph.setPointSizes(new Float32Array(4).fill(16))
    graph.setPointColors(colors)
    graph.render(0, 0)
    graph.setViewTransform({ k: 1, x: 0, y: 0 }, [lineViewport.width, lineViewport.height])
    const frames = []
    for (const { links } of scenes) {
      graph.setLinks(Float32Array.from(links))
      graph.render(0, 0)
      graph.renderOneFrame()
      const pixels = capture()
      const hits = []
      const rgb = []
      for (const [x, y] of probes) {
        const offset = 4 * ratio * (y * pixels.width + x)
        rgb.push(Array.from(pixels.data.subarray(offset, offset + 3)))
        hits.push(await click(x, y))
      }
      graph.setPointColors(colors)
      graph.setLinks(Float32Array.from(links))
      graph.render(0, 0)
      graph.renderOneFrame()
      frames.push({ hits, rgb, pixels, fullUpdate: comparePixels(pixels, capture()).differingPixels })
    }
    return { device: deviceInfo, frames }
  })
}

it.each([1, 2] as const)('draws and picks a replaced link list with the original point records at %i×', async ratio => {
  const webgl = await replay('webgl', ratio)
  const webgpu = await replay('webgpu', ratio)
  const comparisons = webgl.frames.map((frame, i) => {
    const { pixels, ...left } = frame
    const { pixels: other, ...right } = webgpu.frames[i]!
    return { webgl: left, webgpu: right, frame: comparePixels(pixels, other) }
  })
  await writeArtifact(`package-link-topology-${ratio}x`, { ratio, devices: [webgl.device, webgpu.device], comparisons })
  expect(comparisons.map(pair => pair.frame.differingPixels)).toEqual([0, 0, 0, 0])
  for (const result of [webgl, webgpu]) {
    expect(result.frames.map(frame => frame.fullUpdate)).toEqual([0, 0, 0, 0])
    for (const [i, scene] of scenes.entries()) {
      const frame = result.frames[i]!
      expect(frame.hits).toEqual(scene.hits)
      const rgb = scene.hits.map(hit => hit === 'Point 0' ? [255, 0, 0] : hit === 'Background' ? [0, 0, 0] : [0, 255, 0])
      expect(frame.rgb).toEqual(rgb)
    }
  }
})
