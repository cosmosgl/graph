import type { DeviceInfo } from '@luma.gl/core'
import type { ExperimentInstance } from '../../runtime/experiment'
import { lineConfig, lineViewport } from '../production-lines/fixture'
import type { Engine } from './frame'
import { withLinkGraph } from './link-graph'
import { createPairedPickView } from './paired-pick-view'

export const arrowProbes = [
  { label: 'Arrowheads only', x: 120, y: 72 },
  { label: 'Stroke intersection', x: 128, y: 80 },
  { label: 'Red stroke', x: 64, y: 80 },
  { label: 'Green stroke', x: 128, y: 40 },
  { label: 'Background', x: 16, y: 16 },
] as const
const red = { points: [0, 1], color: [1, 0, 0, 0.5] }
const green = { points: [2, 3], color: [0, 1, 0, 0.5] }
const cases = [
  { name: 'Red over green', links: [green, red], arrows: true },
  { name: 'Green over red', links: [red, green], arrows: true },
  { name: 'Red alone', links: [red], arrows: true },
  { name: 'Green alone', links: [green], arrows: true },
  { name: 'Both arrows off', links: [green, red], arrows: false },
] as const

type ArrowSample = {
  name: typeof cases[number]['name'];
  pixels: ImageData;
  sites: { rgb: number[]; pick: string }[];
}

export function runArrowCrossing (engine: Engine, ratio: 1 | 2): Promise<{ device: DeviceInfo; frames: ArrowSample[] }> {
  const config = { ...lineConfig('arrows', ratio), backgroundColor: '#000', linkDefaultWidth: 8, linkBlending: true }
  return withLinkGraph(engine, ratio, config, async ({ graph, deviceInfo, capture, click }) => {
    const { width, height } = lineViewport
    const centers: [number, number][] = [[24, 80], [232, 80], [128, 16], [128, 144]]
    graph.setPointPositions(Float32Array.from(centers.flatMap(([x, y]) => [256 + x - width / 2, 256 - y + height / 2])), true)
    graph.setPointSizes(new Float32Array(centers.length))
    const frames: ArrowSample[] = []
    for (const { name, links, arrows } of cases) {
      graph.setLinks(Float32Array.from(links.flatMap(link => link.points)))
      graph.setLinkColors(Float32Array.from(links.flatMap(link => link.color)))
      graph.setLinkArrows(links.map(() => arrows))
      graph.render(undefined, 0)
      graph.pause()
      graph.setViewTransform({ k: 1, x: 0, y: 0 }, [width, height])
      graph.renderOneFrame()
      const pixels = capture()
      const sites = []
      for (const { x, y } of arrowProbes) {
        const offset = 4 * ratio * (y * pixels.width + x)
        sites.push({ rgb: Array.from(pixels.data.subarray(offset, offset + 3)), pick: await click(x, y) })
      }
      frames.push({ name, pixels, sites })
    }
    return { device: deviceInfo, frames }
  })
}

export function createArrowCrossingView (host: HTMLElement): ExperimentInstance {
  return createPairedPickView(host, {
    caption: 'Click ID and pixel RGB at each location',
    probes: Object.fromEntries(arrowProbes.map(({ label, x, y }) => [label, `${label} (${x}, ${y})`])),
    run: async (engine, ratio) => (await runArrowCrossing(engine, ratio)).frames.map(({ name, pixels, sites }) => ({
      key: name,
      title: name,
      pixels,
      picks: Object.fromEntries(sites.map(({ rgb, pick }, i) => [arrowProbes[i]!.label, `${pick} · (${rgb.join(', ')})`])),
    })),
  })
}
