import type { Graph, GraphConfig } from '../../../../../dist/index.js'

export const lineCases = {
  straight: 'Solid straight links',
  moving: 'Moving endpoint',
  curved: 'Solid curves',
  gradient: 'Endpoint gradients',
  dashed: 'Dashed strokes',
  dotted: 'Dotted strokes',
  arrows: 'Arrows',
  hover: 'Hover color and width',
  zoom: 'Fractional zoom',
} as const
export type LineCase = keyof typeof lineCases
export const exactLineCases: ReadonlySet<string> = new Set(['straight', 'moving', 'gradient', 'dashed', 'zoom'])
export const lineViewport = { width: 256, height: 160 }
export const background = [24, 32, 43] as const
type Pair = [number, number]
export type Probe = { label: string; xy: Pair; expected: string }

// Identity-camera CSS coordinates. The last point covers part of the first link.
// IDs 0–3 are horizontal, vertical, diagonal and a subpixel horizontal stroke.
const centers: Pair[] = [[16, 28], [136, 28], [96.25, 9.375], [96.25, 60.375],
  [20.125, 83.375], [128.875, 138.625], [155.1, 48.4], [234.1, 48.4], [120, 28]]
const colors = [[103, 186, 224], [244, 139, 83], [134, 208, 127], [207, 152, 229]]
export const movedEndpoint: Pair = [136, 52]

function world ([x, y]: Pair): Pair {
  return [256 + x - lineViewport.width / 2, 256 - y + lineViewport.height / 2]
}

export function lineConfig (scene: LineCase, ratio: number): GraphConfig {
  return {
    spaceSize: 512,
    enableSimulation: false,
    enableRenderLoop: false,
    enableDrag: false,
    enableZoom: false,
    fitViewOnInit: false,
    rescalePositions: false,
    transitionDuration: 0,
    pixelRatio: ratio,
    backgroundColor: 'rgb(24,32,43)',
    linkOpacity: 1,
    linkVisibilityMinTransparency: 1,
    curvedLinks: scene === 'curved',
    curvedLinkSegments: 24,
    curvedLinkWeight: 1,
    curvedLinkControlPointDistance: 0.22,
    linkColorInterpolateFromEndpoints: scene === 'gradient',
    linkDashLength: 8,
    linkDashGap: 6,
    linkArrowsSizeScale: 2.5,
    hoveredLinkWidthIncrease: scene === 'hover' ? 4 : 0,
    hoveredLinkColor: scene === 'hover' ? '#f4d96c' : undefined,
  }
}

export function loadLines (graph: Graph, scene: LineCase): void {
  const k = scene === 'zoom' ? 1.25 : 1
  graph.setPointPositions(Float32Array.from(centers.flatMap(world)), true)
  graph.setPointSizes(Float32Array.from(centers, (_, i) => i === 8 ? 10 : 0))
  graph.setPointColors(Float32Array.from(centers.flatMap((_, i) => i === 8 ? [1, 1, 1, 1] : i % 2 ? [0.1, 0.65, 0.95, 1] : [0.95, 0.24, 0.12, 1])))
  graph.setLinks(Float32Array.of(0, 1, 2, 3, 4, 5, 6, 7))
  graph.setLinkWidths(Float32Array.of(2, 3.25, 1.5, 0.75))
  graph.setLinkColors(Float32Array.from(colors.flatMap(rgb => [...rgb.map(v => v / 255), 1])))
  graph.setLinkStyles(Float32Array.from(colors, () => scene === 'dashed' ? 1 : scene === 'dotted' ? 2 : 0))
  graph.setLinkArrows(colors.map(() => scene === 'arrows'))
  graph.render(1, 0)
  graph.pause()
  graph.setViewTransform({ k, x: (1 - k) * 128, y: (1 - k) * 80 }, [256, 160])
}

export function moveEndpoint (graph: Graph, moved: boolean): void {
  const [x, y] = world(moved ? movedEndpoint : centers[1])
  graph.setPointPosition(1, x, y)
}

export function lineProbes (scene: LineCase, moved: boolean): Probe[] {
  const result: Probe[] = []
  const at = (label: string, x: number, y: number, expected: string): void => {
    if (scene === 'zoom') { x = (x - 128) * 1.25 + 128; y = (y - 80) * 1.25 + 80 }
    result.push({ label, xy: [Math.round(x), Math.round(y)], expected })
  }
  const curved = scene === 'curved'
  const center = (t: number): Pair => [
    16 + 120 * t + (curved && moved ? 2 * t * (1 - t) * 0.22 * 24 : 0),
    28 + (moved ? 24 * t : 0) - (curved ? 2 * t * (1 - t) * 0.22 * 120 : 0),
  ]
  const [x, y] = center(0.25)
  at('Stroke', x, y, 'Link 0')
  if (!curved) {
    at('Beside stroke · inside click target', x, y + 2, 'Link 0')
    at('Outside click target', x, y + 8, 'Background')
    at('Link crossing', 96, moved ? 44 : 28, 'Link 1')
    at('Thin link', 180, 48, 'Link 3')
    at('Diagonal', 74, 111, 'Link 2')
    if (scene === 'dashed' || scene === 'dotted') at('Paint gap', ...center((scene === 'dashed' ? 11 : 8) / 120), 'Link 0')
  }
  at(moved || curved ? 'Foreground point' : 'Point over path', 120, 28, 'Point 8')
  if (moved) at('Former stroke position', 60, curved ? 16 : 28, 'Background')
  at('Empty canvas', 200, 106, 'Background')
  return result
}
