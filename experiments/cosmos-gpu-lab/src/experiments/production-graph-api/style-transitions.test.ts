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

it.each([
  ['webgl', 1], ['webgpu', 1], ['webgl', 2], ['webgpu', 2],
] as const)('follows the drawn point and link with getters and a story label in the %s package at %i×', async (engine, pixelRatio) => {
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
      pixelRatio,
      enableSimulation: false,
      enableRenderLoop: false,
      fitViewOnInit: false,
      rescalePositions: false,
      backgroundColor: '#000',
      pointDefaultColor: '#f00',
      pointGreyoutColor: '#00f',
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
        context.drawImage(canvas, 0, 0, 256, 256)
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
        // Hosts can replace a callback or highlight a selection at any point in a running style transition.
        graph.setConfigPartial({ simulationGravity: 0.1, onClick: () => {} })
        expect(sample(0)).toEqual(midpoint)
        graph.setConfig({ ...graph.config, simulationFriction: 0.5 })
        expect(sample(0)).toEqual(midpoint)
        graph.setConfigPartial({ highlightedPointIndices: [0] })
        expect(sample(0)).toEqual(midpoint)
        expect(Array.from(context.getImageData(192, 128, 1, 1).data)).toEqual([0, 0, 255, 255])
        graph.setConfigPartial({ highlightedPointIndices: undefined })
        expect(sample(0)).toEqual(midpoint)
        expect(Array.from(context.getImageData(192, 128, 1, 1).data)).toEqual([255, 0, 0, 255])
        graph.create()
        expect(sample(0)).toEqual(midpoint)
        graph.render()
        const redraw = sample(0)
        const complete = [start, midpoint, sample(500)]
        resize(4, 2)
        const beforeInterrupt = sample(500)
        resize(28, 14)
        const interrupted = [sample(0), sample(500), sample(500)]
        await writeArtifact(`package-style-transition-${engine}-dpr${pixelRatio}`, { device: graph.simulation.device?.info, complete, redraw, beforeInterrupt, interrupted })
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

        // Changing the highlighted IDs affects the current fill immediately, including while the fill itself is changing.
        graph.setPointImageIndices(Float32Array.of(-1, -1))
        graph.setPointColors(Float32Array.of(1, 0, 0, 1, 1, 0, 0, 1))
        graph.render(undefined, 0)
        graph.setPointColors(Float32Array.of(0, 0, 1, 1, 0, 0, 1, 1))
        graph.render(undefined, 1000)
        sample(500)
        const secondFill = (): number[] => Array.from(context.getImageData(192, 128, 1, 1).data)
        const halfway = secondFill()
        expect(halfway).toEqual([128, 0, 128, 255])
        graph.setConfigPartial({ highlightedPointIndices: [0] })
        sample(0)
        expect(secondFill()).toEqual([0, 0, 255, 255])
        graph.setConfigPartial({ highlightedPointIndices: undefined })
        sample(0)
        expect(secondFill()).toEqual(halfway)

        // A caller may resubmit a modified color tuple by reference.
        const color: [number, number, number, number] = [1, 0, 0, 1]
        graph.setConfigPartial({ linkDefaultColor: color })
        expect(Array.from(graph.getLinkColors())).toEqual(color)
        color[0] = 0
        color[2] = 1
        graph.setConfigPartial({ linkDefaultColor: color })
        expect(Array.from(graph.getLinkColors())).toEqual(color)
      } finally { clock.mockRestore() }
    } finally { graph.destroy() }
  } finally { scene.remove() }
})
