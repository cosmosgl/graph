import { expect, it, vi } from 'vitest'
import { CosmosLabels } from '../../../../../src/stories/points/labels/labels'
import { writeArtifact } from '../../testing/artifacts'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'

type Sample = {
  radius?: number;
  width?: number;
  labelBottom: number;
  pointPixels: number;
  linkPixels: number;
}

function expected (radius: number, width: number): Sample {
  return { radius, width, labelBottom: 128 - radius - 2, pointPixels: radius, linkPixels: width }
}

it.each(['webgl', 'webgpu'] as const)('follows the drawn point and link with getters and a story label in the %s package', async engine => {
  const scene = document.createElement('div')
  scene.style.cssText = 'position:relative;width:256px;height:256px'
  const frame = document.createElement('iframe')
  frame.style.cssText = 'width:100%;height:100%;border:0'
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none'
  scene.append(frame, overlay)
  document.body.append(scene)
  try {
    const doc = frame.contentDocument!
    doc.body.style.margin = '0'
    const GRAPH = await loadGraphPackage(engine, doc)
    const host = doc.createElement('div')
    host.style.cssText = 'position:relative;width:256px;height:256px'
    doc.body.append(host)
    const graph = new GRAPH(host, {
      pixelRatio: 1,
      enableSimulation: false,
      enableRenderLoop: false,
      fitViewOnInit: false,
      rescalePositions: false,
      backgroundColor: '#000',
      pointDefaultColor: '#f00',
      linkDefaultColor: '#0f0',
      linkVisibilityMinTransparency: 1,
    })
    try {
      await graph.ready
      const positions = new Map<number, [number, number]>([[0, [1984, 2048]]])
      const labels = new CosmosLabels(overlay, new Map([[0, 'Point 0']]))
      graph.setPointPositions(Float32Array.of(1984, 2048, 2112, 2048))
      graph.setLinks(Float32Array.of(0, 1))
      const pointSizes = new Float32Array(2)
      const linkWidths = new Float32Array(1)
      const resize = (radius: number, width: number, duration = 1000): void => {
        // The caller reuses its arrays. The previous displayed values belong to the graph.
        graph.setPointSizes(pointSizes.fill(radius))
        graph.setLinkWidths(linkWidths.fill(width))
        graph.render(undefined, duration)
      }
      resize(4, 2, 0)
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [256, 256])
      const canvas = host.querySelector('canvas')!
      const copy = doc.createElement('canvas')
      copy.width = copy.height = 256
      const context = copy.getContext('2d', { willReadFrequently: true })!
      let now = 0
      const clock = vi.spyOn(frame.contentWindow!.performance, 'now').mockImplementation(() => now)
      const sample = (advance: number): Sample => {
        now += advance
        graph.renderOneFrame()
        context.drawImage(canvas, 0, 0)
        // Count the filled vertical span at the left point's center and halfway along the link.
        const span = (x: number, channel: number): number => {
          const column = context.getImageData(x, 0, 1, 256).data
          let pixels = 0
          for (let i = channel; i < column.length; i += 4) if (column[i]! > 127) pixels++
          return pixels
        }
        labels.update(graph, positions)
        const label = overlay.querySelector('.css-label--label')!
        return {
          radius: graph.getPointRadiusByIndex(0),
          width: graph.getLinkWidthByIndex(0),
          labelBottom: label.getBoundingClientRect().bottom - overlay.getBoundingClientRect().top,
          pointPixels: span(64, 0),
          linkPixels: span(128, 1),
        }
      }
      try {
        resize(20, 10)
        const start = sample(0)
        const midpoint = sample(500)
        graph.create()
        expect(sample(0)).toEqual(midpoint)
        graph.render()
        const redraw = sample(0)
        const complete = [start, midpoint, sample(500)]
        resize(4, 2)
        const beforeInterrupt = sample(500)
        resize(28, 14)
        const interrupted = [sample(0), sample(500), sample(500)]
        await writeArtifact(`package-style-transition-${engine}`, { device: graph.simulation.device?.info, complete, redraw, beforeInterrupt, interrupted })
        expect(complete).toEqual([expected(4, 2), expected(12, 6), expected(20, 10)])
        expect(redraw).toEqual(midpoint)
        expect(beforeInterrupt).toEqual(expected(12, 6))
        // WebGL starts the next cycle at the previous target. WebGPU continues from the displayed frame.
        const restart = engine === 'webgpu' ? [expected(12, 6), expected(20, 10)] : [expected(4, 2), expected(16, 8)]
        expect(interrupted).toEqual([...restart, expected(28, 14)])

        // An image can set a larger footprint while the point shape is still growing.
        graph.setImageData([new ImageData(Uint8ClampedArray.of(255, 0, 0, 255), 1, 1)])
        graph.setPointImageIndices(Float32Array.of(0, -1))
        graph.setPointImageSizes(Float32Array.of(8, 0))
        resize(4, 2, 0)
        graph.setPointImageSizes(Float32Array.of(16, 0))
        resize(20, 10)
        expect([sample(0), sample(500), sample(500)]).toEqual([expected(16, 2), expected(16, 6), expected(20, 10)])
      } finally { clock.mockRestore() }
    } finally { graph.destroy() }
  } finally { scene.remove() }
})
