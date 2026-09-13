import { Graph, type GraphConfig, LinkStyle, PointShape } from '@cosmos.gl/graph'

// One page, three pixel ratios. Each pane draws the same scene: every point
// shape, plain (top) and outlined (bottom), at 0.5–16 px, and a ring of links
// from 0.25 px to 8 px wide at every angle. The panes share one camera —
// scroll to zoom and the edges pass through every size on all three at once.
// The toggles apply to all panes.

const SPACE = 4096
const PIXEL_RATIOS = [0.5, 1, 2]
const SHAPES = [
  PointShape.Circle, PointShape.Square, PointShape.Triangle, PointShape.Diamond,
  PointShape.Pentagon, PointShape.Hexagon, PointShape.Star, PointShape.Cross,
]
const SHAPE_COLORS: [number, number, number][] = [
  [1.0, 0.42, 0.38], [0.13, 0.55, 0.45], [0.25, 0.32, 0.71], [0.96, 0.76, 0.19],
  [0.74, 0.24, 0.45], [0.18, 0.55, 0.56], [0.85, 0.45, 0.28], [0.58, 0.44, 0.86],
]
const SIZES = [0.5, 1, 2, 4, 8, 16] // CSS px at zoom 1
const SPOKES = 48
const WIDTH_RANGE = [0.25, 8] // CSS px at zoom 1, growing clockwise
const FAN_INNER = 30
const FAN_OUTER = 120

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const f = (n: number): number => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

// ── Scene ───────────────────────────────────────────────────────────────────

type Scene = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  shapes: Float32Array;
  outlined: number[];
  // Circle points, for the reference rings: the exact nominal size, drawn in SVG.
  circles: { index: number; size: number }[];
  links: Float32Array;
  linkColors: Float32Array;
  linkWidths: Float32Array;
}

const buildScene = (): Scene => {
  const positions: number[] = []
  const colors: number[] = []
  const sizes: number[] = []
  const shapes: number[] = []
  const outlined: number[] = []
  const circles: { index: number; size: number }[] = []
  const links: number[] = []
  const linkColors: number[] = []
  const linkWidths: number[] = []

  const colPitch = 30
  const rowPitch = 34
  const gap = 30
  const gridW = (SHAPES.length - 1) * colPitch
  const gridH = (SIZES.length - 1) * rowPitch
  const totalW = gridW + gap + FAN_OUTER * 2
  const left = SPACE / 2 - totalW / 2
  const cy = SPACE / 2

  // Two grids of shapes × sizes, one above the other; the lower one is outlined.
  // Space y grows upward, so rows are laid out from the top edge downward.
  for (const [block, isOutlined] of [[0, false], [1, true]] as const) {
    const top = cy + (gridH * 2 + gap) / 2 - block * (gridH + gap)
    SHAPES.forEach((shape, column) => {
      SIZES.forEach((size, row) => {
        const index = positions.length / 2
        positions.push(left + column * colPitch, top - row * rowPitch)
        colors.push(...SHAPE_COLORS[column]!, 1)
        sizes.push(size)
        shapes.push(shape)
        if (isOutlined) outlined.push(index)
        if (shape === PointShape.Circle) circles.push({ index, size })
      })
    })
  }

  // A ring of spokes: link width grows clockwise, hue follows the angle.
  const fx = left + gridW + gap + FAN_OUTER
  for (let s = 0; s < SPOKES; s += 1) {
    const angle = (2 * Math.PI * s) / SPOKES
    const inner = positions.length / 2
    positions.push(fx + Math.cos(angle) * FAN_INNER, cy + Math.sin(angle) * FAN_INNER)
    positions.push(fx + Math.cos(angle) * FAN_OUTER, cy + Math.sin(angle) * FAN_OUTER)
    colors.push(0.75, 0.75, 0.75, 1, 0.75, 0.75, 0.75, 1)
    sizes.push(1, 2)
    shapes.push(PointShape.Circle, PointShape.Circle)
    links.push(inner, inner + 1)
    const t = s / (SPOKES - 1)
    linkWidths.push(WIDTH_RANGE[0]! * (WIDTH_RANGE[1]! / WIDTH_RANGE[0]!) ** t)
    linkColors.push(...hslToRgb(t, 0.75, 0.62), 1)
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    sizes: new Float32Array(sizes),
    shapes: new Float32Array(shapes),
    outlined,
    circles,
    links: new Float32Array(links),
    linkColors: new Float32Array(linkColors),
    linkWidths: new Float32Array(linkWidths),
  }
}

// ── Panes ───────────────────────────────────────────────────────────────────

type Toggles = {
  linkBlending: boolean;
  linkDefaultArrows: boolean;
  curvedLinks: boolean;
  scaleOnZoom: boolean;
  linkDefaultStyle: LinkStyle;
  referenceRings: boolean;
}

const paneConfig = (pixelRatio: number, t: Toggles): GraphConfig => ({
  spaceSize: SPACE,
  pixelRatio,
  backgroundColor: '#1a1d23',
  enableSimulation: false,
  rescalePositions: false,
  fitViewOnInit: false,
  scalePointsOnZoom: t.scaleOnZoom,
  scaleLinksOnZoom: t.scaleOnZoom,
  linkBlending: t.linkBlending,
  linkDefaultArrows: t.linkDefaultArrows,
  curvedLinks: t.curvedLinks,
  linkDefaultStyle: t.linkDefaultStyle,
  renderHoveredPointRing: true,
  hoveredPointRingColor: '#ffffff',
  outlinedPointRingColor: '#ffffff',
  enableDrag: false,
  linkVisibilityMinTransparency: 0.9,
})

// The panes share one camera. Cosmos exposes no transform setter, so the
// zoom is mirrored through the graph's private d3 zoom behavior — story-only.
type GraphInternals = {
  canvasD3Selection?: { call: (fn: unknown, transform: unknown) => void };
  zoomInstance: { behavior: { transform: unknown } };
}

const applyTransform = (graph: Graph, transform: unknown): void => {
  const g = graph as unknown as GraphInternals
  g.canvasD3Selection?.call(g.zoomInstance.behavior.transform, transform)
}

// Reference rings: an SVG circle of the exact nominal diameter (size × zoom in
// CSS px, or the constant-size rule when not scaling) over every circle point.
// A correctly sized point fills the ring; the ring is what a legend would draw.
const createReferenceOverlay = (host: HTMLElement, graph: Graph, scene: Scene, toggles: Toggles): (() => void) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;'
  const rings = scene.circles.map(() => {
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    ring.setAttribute('fill', 'none')
    ring.setAttribute('stroke', 'rgba(255,255,255,0.45)')
    ring.setAttribute('stroke-width', '1')
    svg.appendChild(ring)
    return ring
  })
  host.appendChild(svg)
  return (): void => {
    svg.style.display = toggles.referenceRings ? '' : 'none'
    if (!toggles.referenceRings) return
    const k = graph.getZoomLevel()
    const scale = toggles.scaleOnZoom ? k : Math.min(5, Math.max(1, k * 0.01))
    scene.circles.forEach(({ index, size }, i) => {
      const [x, y] = graph.spaceToScreenPosition([scene.positions[index * 2]!, scene.positions[index * 2 + 1]!])
      const ring = rings[i]!
      ring.setAttribute('cx', String(x))
      ring.setAttribute('cy', String(y))
      // Stroke centred on the edge: the ring's centreline is the nominal radius.
      ring.setAttribute('r', String((size * scale) / 2))
    })
  }
}

export const antiAliasing = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const scene = buildScene()
  const toggles: Toggles = {
    linkBlending: true,
    linkDefaultArrows: false,
    curvedLinks: false,
    scaleOnZoom: true,
    linkDefaultStyle: LinkStyle.Solid,
    referenceRings: true,
  }

  const outer = document.createElement('div')
  outer.style.cssText =
    'height:100vh;width:100%;background:#1a1d23;color:#e0e0e0;font-family:monospace;font-size:12px;display:flex;flex-direction:column;overflow:hidden;'

  const bar = document.createElement('div')
  bar.style.cssText = 'padding:8px 14px;display:flex;gap:18px;align-items:center;flex:none;border-bottom:1px solid #3a3f47;'
  bar.innerHTML = '<span>Shapes 0.5–16 px, plain above and outlined below; links 0.25–8 px clockwise. Scroll to zoom all three.</span>'
  const zoomLabel = document.createElement('span')
  zoomLabel.style.cssText = 'margin-left:auto;color:#9aa3ad;'
  outer.appendChild(bar)

  const panesRow = document.createElement('div')
  panesRow.style.cssText = 'flex:1;display:flex;min-height:0;'
  outer.appendChild(panesRow)

  const graphs: Graph[] = []
  const overlayUpdates: (() => void)[] = []
  let syncing = false

  PIXEL_RATIOS.forEach((pixelRatio, i) => {
    const pane = document.createElement('div')
    pane.style.cssText = `flex:1;min-width:0;display:flex;flex-direction:column;${i > 0 ? 'border-left:1px solid #3a3f47;' : ''}`
    const header = document.createElement('div')
    header.style.cssText = 'padding:6px 14px;flex:none;color:#7fd1c0;font-weight:bold;'
    header.textContent = `pixelRatio ${pixelRatio} — 1 CSS px = ${pixelRatio} device px`
    const host = document.createElement('div')
    host.style.cssText = 'flex:1;min-height:0;position:relative;'
    pane.appendChild(header)
    pane.appendChild(host)
    panesRow.appendChild(pane)

    const graph = new Graph(host, {
      ...paneConfig(pixelRatio, toggles),
      onZoom: (e, userDriven): void => {
        updateOverlay()
        if (!userDriven || syncing) return
        syncing = true
        for (const other of graphs) if (other !== graph) applyTransform(other, e.transform)
        syncing = false
        zoomLabel.textContent = `zoom ${e.transform.k.toFixed(2)}`
      },
    })
    const updateOverlay = createReferenceOverlay(host, graph, scene, toggles)
    overlayUpdates.push(updateOverlay)
    graph.setPointPositions(scene.positions)
    graph.setPointColors(scene.colors)
    graph.setPointSizes(scene.sizes)
    graph.setPointShapes(scene.shapes)
    graph.setLinks(scene.links)
    graph.setLinkColors(scene.linkColors)
    graph.setLinkWidths(scene.linkWidths)
    graph.setConfigPartial({ outlinedPointIndices: scene.outlined })
    graph.render()
    // Fit at zoom 1: a size of n is n CSS px in every pane.
    graph.setZoomTransformByPointPositions(scene.positions, 0, 1)
    graphs.push(graph)
  })
  const resizeObserver = new ResizeObserver(() => overlayUpdates.forEach((update) => update()))
  resizeObserver.observe(panesRow)

  const applyToggles = (): void => {
    for (const graph of graphs) graph.setConfigPartial(paneConfig(graph.config.pixelRatio, toggles))
    overlayUpdates.forEach((update) => update())
  }

  const addToggle = (label: string, key: Exclude<keyof Toggles, 'linkDefaultStyle'>): void => {
    const wrap = document.createElement('label')
    wrap.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer;'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = toggles[key]
    input.addEventListener('change', () => {
      toggles[key] = input.checked
      applyToggles()
    })
    wrap.appendChild(input)
    wrap.appendChild(document.createTextNode(label))
    bar.appendChild(wrap)
  }
  addToggle('linkBlending', 'linkBlending')
  addToggle('arrows', 'linkDefaultArrows')
  addToggle('curved', 'curvedLinks')
  addToggle('scale on zoom', 'scaleOnZoom')
  addToggle('reference rings', 'referenceRings')
  const style = document.createElement('select')
  style.setAttribute('aria-label', 'Link style')
  style.style.cssText = 'font:inherit;'
  for (const [label, value] of [['solid', LinkStyle.Solid], ['dashed', LinkStyle.Dashed], ['dotted', LinkStyle.Dotted]] as const) {
    const option = document.createElement('option')
    option.textContent = label
    option.value = String(value)
    style.appendChild(option)
  }
  style.addEventListener('change', () => {
    toggles.linkDefaultStyle = Number(style.value) as LinkStyle
    applyToggles()
  })
  bar.appendChild(style)
  const reset = document.createElement('button')
  reset.textContent = '1:1'
  reset.style.cssText = 'font:inherit;padding:1px 8px;cursor:pointer;'
  reset.addEventListener('click', () => {
    for (const graph of graphs) graph.setZoomTransformByPointPositions(scene.positions, 250, 1)
    zoomLabel.textContent = 'zoom 1.00'
  })
  bar.appendChild(reset)
  zoomLabel.textContent = 'zoom 1.00'
  bar.appendChild(zoomLabel)

  return {
    graph: graphs[0]!,
    div: outer,
    destroy: (): void => {
      resizeObserver.disconnect()
      // The story contract tears down `graph` (the first pane); the rest are ours.
      for (const graph of graphs.slice(1)) graph.destroy()
    },
  }
}
