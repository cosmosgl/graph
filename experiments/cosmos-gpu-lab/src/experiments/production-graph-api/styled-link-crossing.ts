import type { DeviceInfo } from '@luma.gl/core'
import { lineConfig, lineViewport } from '../production-lines/fixture'
import type { Engine } from './frame'
import { withLinkGraph } from './link-graph'

export const styledLinkProbes = [
  { key: 'crossing', x: 128, y: 80 },
  { key: 'horizontal', x: 64, y: 80 },
  { key: 'opposite', x: 80, y: 80 },
  { key: 'vertical', x: 128, y: 40 },
  { key: 'background', x: 16, y: 16 },
] as const

const solid = { endpoints: [0, 1], style: 0, color: [0, 1, 0, 1] }
const dashed = { endpoints: [2, 3], style: 1, color: [1, 0, 0, 1] }
const orders = [
  { order: 'solid-dashed', links: [solid, dashed] },
  { order: 'dashed-solid', links: [dashed, solid] },
  { order: 'solid-only', links: [solid] },
  { order: 'dashed-only', links: [dashed] },
] as const

type Probe = typeof styledLinkProbes[number]['key']
export type StyledLinkSample = {
  phase: 'dash' | 'gap';
  order: typeof orders[number]['order'];
  pixels: ImageData;
  sites: Record<Probe, { rgb: number[]; pick: string }>;
}

export function runStyledLinkCrossing (engine: Engine, ratio: 1 | 2): Promise<{ deviceInfo: DeviceInfo; samples: StyledLinkSample[] }> {
  const config = { ...lineConfig('dashed', ratio), backgroundColor: '#000', linkDefaultWidth: 8, linkDashLength: 16, linkDashGap: 16 }
  return withLinkGraph(engine, ratio, config, async ({ graph, deviceInfo, capture, click }) => {
    const { width, height } = lineViewport
    const samples: StyledLinkSample[] = []
    for (const phase of ['dash', 'gap'] as const) {
      // The horizontal link slides along its own axis. The intersection remains (128, 80)
      // and falls 8 or 24 CSS px into its 32 px period. Both are well inside a band.
      const start = phase === 'dash' ? 24 : 40
      const centers: [number, number][] = [[128, 20], [128, 140], [start, 80], [start + 192, 80]]
      graph.setPointPositions(Float32Array.from(centers.flatMap(([x, y]) => [256 + x - width / 2, 256 - y + height / 2])), true)
      graph.setPointSizes(new Float32Array(centers.length))
      for (const { order, links } of orders) {
        // Array order is the public link ID. A single-link control always has ID 0.
        graph.setLinks(Float32Array.from(links.flatMap(link => link.endpoints)))
        graph.setLinkStyles(Float32Array.from(links, link => link.style))
        graph.setLinkColors(Float32Array.from(links.flatMap(link => link.color)))
        graph.render(undefined, 0)
        graph.pause()
        graph.setViewTransform({ k: 1, x: 0, y: 0 }, [width, height])
        graph.renderOneFrame()
        const pixels = capture()
        const sites = {} as StyledLinkSample['sites']
        for (const { key, x, y } of styledLinkProbes) {
          const offset = 4 * ratio * (y * pixels.width + x)
          sites[key] = { rgb: Array.from(pixels.data.subarray(offset, offset + 3)), pick: await click(x, y) }
        }
        samples.push({ phase, order, pixels, sites })
      }
    }
    return { deviceInfo, samples }
  })
}
