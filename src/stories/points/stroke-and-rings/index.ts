import { Graph } from '@cosmos.gl/graph'

type StrokeColor = 'auto' | 'darken' | 'lighten' | 'white'
type RingSet = 'none' | 'every-7th' | 'largest'
type RingColor = 'white' | 'black' | 'coral'

interface ControlHandlers {
  onStrokeWidthChange: (width: number) => void;
  onStrokeColorChange: (color: StrokeColor) => void;
  onRingSetChange: (set: RingSet) => void;
  onRingColorChange: (color: RingColor) => void;
  onHoverRingChange: (on: boolean) => void;
  onFocusChange: (on: boolean) => void;
  onHighlightChange: (on: boolean) => void;
}

const SPACE_SIZE = 4096
const BACKGROUND = '#2d313a'
const GROUP_COUNT = 6
const PER_GROUP = 120
const FOCUSED_INDEX = 42

const PALETTE: [number, number, number][] = [
  [1.0, 0.42, 0.38],
  [0.13, 0.55, 0.45],
  [0.25, 0.32, 0.71],
  [0.96, 0.76, 0.19],
  [0.74, 0.24, 0.45],
  [0.58, 0.44, 0.86],
]

const RING_COLORS: Record<RingColor, string> = { white: '#ffffff', black: '#000000', coral: '#ff6b61' }

/** Deterministic pseudo-random in [0, 1): the layout is static, so it should look the same on every load. */
function makeRandom (seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/**
 * Six clumps of mixed-size points, dense enough that neighbours overlap, seeded on a ring.
 * Static (no simulation), sizes in exact CSS px.
 */
function buildData (): { positions: Float32Array; colors: Float32Array; sizes: Float32Array; groups: Uint8Array } {
  const random = makeRandom(7)
  const count = GROUP_COUNT * PER_GROUP
  const positions = new Float32Array(count * 2)
  const colors = new Float32Array(count * 4)
  const sizes = new Float32Array(count)
  const groups = new Uint8Array(count)
  const centre = SPACE_SIZE / 2
  const ringRadius = SPACE_SIZE * 0.22
  const clumpRadius = SPACE_SIZE * 0.09
  for (let g = 0; g < GROUP_COUNT; g++) {
    const angle = (g / GROUP_COUNT) * Math.PI * 2
    const cx = centre + ringRadius * Math.cos(angle)
    const cy = centre + ringRadius * Math.sin(angle)
    const color = PALETTE[g] ?? [1, 1, 1]
    for (let k = 0; k < PER_GROUP; k++) {
      const i = g * PER_GROUP + k
      const r = clumpRadius * Math.sqrt(random())
      const a = random() * Math.PI * 2
      positions[i * 2] = cx + r * Math.cos(a)
      positions[i * 2 + 1] = cy + r * Math.sin(a)
      colors.set([color[0], color[1], color[2], 1], i * 4)
      sizes[i] = 4 + 14 * random() ** 2
      groups[i] = g
    }
  }
  return { positions, colors, sizes, groups }
}

function buildControls (handlers: ControlHandlers): HTMLDivElement {
  const panel = document.createElement('div')
  panel.style.cssText = [
    'position: absolute', 'top: 16px', 'right: 16px', 'z-index: 1000',
    'display: flex', 'flex-direction: column', 'gap: 8px', 'min-width: 240px',
    'padding: 14px 16px', 'background: rgba(22, 22, 28, 0.85)',
    'border: 1px solid rgba(255, 255, 255, 0.12)', 'border-radius: 10px',
    'color: #e8e8ec', 'font: 13px Helvetica, Arial, sans-serif', 'user-select: none',
  ].join(';')

  const heading = (text: string): void => {
    const el = document.createElement('div')
    el.textContent = text
    el.style.cssText = 'font-weight: 700; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px;'
    panel.appendChild(el)
  }
  const divider = (): void => {
    const el = document.createElement('div')
    el.style.cssText = 'height: 1px; background: rgba(255, 255, 255, 0.12); margin: 4px 0;'
    panel.appendChild(el)
  }
  const row = (): HTMLLabelElement => {
    const el = document.createElement('label')
    el.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer;'
    return el
  }
  const radios = <T extends string>(group: string, options: [string, T][], initial: T, onChange: (value: T) => void): void => {
    for (const [label, value] of options) {
      const el = row()
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = group
      input.checked = value === initial
      input.addEventListener('change', () => { if (input.checked) onChange(value) })
      el.append(input, document.createTextNode(label))
      panel.appendChild(el)
    }
  }
  const checkbox = (label: string, initial: boolean, onChange: (on: boolean) => void): void => {
    const el = row()
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = initial
    input.addEventListener('change', () => onChange(input.checked))
    el.append(input, document.createTextNode(label))
    panel.appendChild(el)
  }
  const slider = (label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void): void => {
    const el = document.createElement('label')
    el.style.cssText = 'display: flex; flex-direction: column; gap: 4px; cursor: pointer;'
    const caption = document.createElement('span')
    caption.style.cssText = 'display: flex; justify-content: space-between;'
    const name = document.createElement('span')
    name.textContent = label
    const readout = document.createElement('span')
    readout.style.opacity = '0.7'
    readout.textContent = value.toFixed(2)
    caption.append(name, readout)
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    input.addEventListener('input', () => {
      const v = Number(input.value)
      readout.textContent = v.toFixed(2)
      onChange(v)
    })
    el.append(caption, input)
    panel.appendChild(el)
  }

  heading('Stroke (every point, inset)')
  slider('Width (px)', 0, 3, 0.25, 1, handlers.onStrokeWidthChange)
  const strokeColors: [string, StrokeColor][] = [['Auto (shade of the fill)', 'auto'], ['Darken', 'darken'], ['Lighten', 'lighten'], ['White', 'white']]
  radios<StrokeColor>('stroke-color', strokeColors, 'auto', handlers.onStrokeColorChange)

  divider()
  heading('Outline ring (outlinedPointIndices, outside)')
  radios<RingSet>('ring-set', [['None', 'none'], ['Every 7th point', 'every-7th'], ['Largest 10%', 'largest']], 'every-7th', handlers.onRingSetChange)
  radios<RingColor>('ring-color', [['White ring', 'white'], ['Black ring', 'black'], ['Coral ring', 'coral']], 'white', handlers.onRingColorChange)

  divider()
  heading('Other rings')
  checkbox('Hover ring', true, handlers.onHoverRingChange)
  checkbox(`Focus point #${FOCUSED_INDEX}`, true, handlers.onFocusChange)
  checkbox('Highlight one group (grey out the rest)', false, handlers.onHighlightChange)

  return panel
}

/**
 * The inset stroke and the selection rings side by side. The stroke is a rendering style every
 * point carries, drawn inside the edge in a shade of the point's own color (or white here); the
 * rings are selection marks — `outlinedPointIndices`, the hover ring, the focused point — drawn
 * outside the body in one uniform color. With highlighting on, greyed points keep a greyed
 * stroke while their outline ring is skipped.
 */
export const strokeAndRings = (): { div: HTMLDivElement; graph: Graph } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const data = buildData()

  const graph = new Graph(div, {
    spaceSize: SPACE_SIZE,
    backgroundColor: BACKGROUND,
    enableSimulation: false,
    rescalePositions: false,
    scalePointsOnZoom: false,
    fitViewOnInit: false,
    pointDefaultStrokeWidth: 1,
    pointDefaultStrokeColor: 'auto',
    pointStrokeContrast: 0.1,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#ffffff',
    focusedPointIndex: FOCUSED_INDEX,
    focusedPointRingColor: '#ffffff',
    outlinedPointRingColor: RING_COLORS.white,
    pointGreyoutOpacity: 0.4,
    enableDrag: true,
  })

  graph.setPointPositions(data.positions)
  graph.setPointColors(data.colors)
  graph.setPointSizes(data.sizes)
  graph.render()
  graph.fitViewByPointPositions(Array.from(data.positions), 0, 0.05)

  const ringIndices = (set: RingSet): number[] | undefined => {
    const count = data.sizes.length
    if (set === 'none') return undefined
    if (set === 'every-7th') return Array.from({ length: Math.floor(count / 7) }, (_, k) => k * 7)
    const threshold = [...data.sizes].sort((a, b) => b - a)[Math.floor(count * 0.1)] ?? 0
    return Array.from(data.sizes, (s, i) => (s >= threshold ? i : -1)).filter(i => i >= 0)
  }
  const highlightIndices = (): number[] => Array.from({ length: PER_GROUP }, (_, k) => 2 * PER_GROUP + k)

  graph.setConfigPartial({ outlinedPointIndices: ringIndices('every-7th') })

  div.appendChild(buildControls({
    onStrokeWidthChange: width => graph.setConfigPartial({ pointDefaultStrokeWidth: width }),
    onStrokeColorChange: color => graph.setConfigPartial({ pointDefaultStrokeColor: color === 'white' ? '#ffffff' : color }),
    onRingSetChange: set => graph.setConfigPartial({ outlinedPointIndices: ringIndices(set) }),
    onRingColorChange: color => graph.setConfigPartial({ outlinedPointRingColor: RING_COLORS[color] }),
    onHoverRingChange: on => graph.setConfigPartial({ renderHoveredPointRing: on }),
    onFocusChange: on => graph.setConfigPartial({ focusedPointIndex: on ? FOCUSED_INDEX : undefined }),
    onHighlightChange: on => graph.setConfigPartial({ highlightedPointIndices: on ? highlightIndices() : undefined }),
  }))

  return { div, graph }
}
