import { Graph, PointShape, type GraphConfig } from '@cosmos.gl/graph'

type StrokeMode = GraphConfig['pointStrokeMode']
type Layout = 'grid' | 'clusters'

interface ControlHandlers {
  onLayoutChange: (layout: Layout) => void;
  onWidthChange: (width: number) => void;
  onIntensityChange: (intensity: number) => void;
  onModeChange: (mode: StrokeMode) => void;
  onBackgroundChange: (dark: boolean) => void;
}

interface PointData {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  shapes: Float32Array;
  clusters?: number[];
}

const DARK_BACKGROUND = '#2d313a'
const LIGHT_BACKGROUND = '#f4f4f6'
const SPACE_SIZE = 4096

const STROKE_WIDTH = 0.75
const STROKE_INTENSITY = 0.1

// fitView's scale is proportional to (1 - 2 * padding): the default 0.1 fills 80% of the
// viewport, so -0.4 fills 160% — twice as close, still centred. The piles are the subject of
// the cluster layout; the gaps between them are not.
const CLUSTER_FIT_PADDING = -0.4

// One hue per row band / cluster; every color is mid-tone so both shade directions read.
const PALETTE: [number, number, number][] = [
  [1.0, 0.42, 0.38],
  [0.13, 0.55, 0.45],
  [0.25, 0.32, 0.71],
  [0.96, 0.76, 0.19],
  [0.74, 0.24, 0.45],
  [0.18, 0.55, 0.56],
  [0.85, 0.45, 0.28],
  [0.58, 0.44, 0.86],
]

function fillColor (colors: Float32Array, i: number, rgb: [number, number, number]): void {
  colors[i * 4] = rgb[0]
  colors[i * 4 + 1] = rgb[1]
  colors[i * 4 + 2] = rgb[2]
  colors[i * 4 + 3] = 1
}

/**
 * Static grid: all eight shapes, sizes growing left to right from sub-pixel to large, so the
 * "no stroke on points narrower than the stroke" rule is visible at the left edge. Sizes are
 * exact CSS pixels (the grid runs with `scalePointsOnZoom` off), so the ramp reads the same on
 * any viewport.
 */
function buildGridData (): PointData {
  const columns = 48
  const rows = 24
  const count = columns * rows
  const positions = new Float32Array(count * 2)
  const colors = new Float32Array(count * 4)
  const sizes = new Float32Array(count)
  const shapes = new Float32Array(count)

  const margin = SPACE_SIZE * 0.06
  const cellX = (SPACE_SIZE - 2 * margin) / (columns - 1)
  const cellY = (SPACE_SIZE - 2 * margin) / (rows - 1)
  for (let i = 0; i < count; i++) {
    const column = i % columns
    const row = Math.floor(i / columns)
    positions[i * 2] = margin + column * cellX
    positions[i * 2 + 1] = margin + row * cellY
    fillColor(colors, i, PALETTE[row % PALETTE.length] ?? [1, 1, 1])
    // Quadratic ramp so the small end is well sampled.
    const t = column / (columns - 1)
    sizes[i] = 0.5 + 28 * t * t
    shapes[i] = (row % 8) as PointShape
  }
  return { positions, colors, sizes, shapes }
}

/**
 * Overlapping clusters: points seeded in tight clumps around eight cluster centres, mixed
 * sizes, all circles. Run with a weak repulsion and a strong cluster force so the simulation
 * settles into dense piles where strokes have to separate neighbours from each other.
 */
function buildClusterData (): PointData {
  const clusterCount = PALETTE.length
  const perCluster = 300
  const count = clusterCount * perCluster
  const positions = new Float32Array(count * 2)
  const colors = new Float32Array(count * 4)
  const sizes = new Float32Array(count)
  const shapes = new Float32Array(count)
  const clusters = new Array<number>(count)

  const ringRadius = SPACE_SIZE * 0.16
  const clumpRadius = SPACE_SIZE * 0.07
  const centre = SPACE_SIZE / 2
  for (let c = 0; c < clusterCount; c++) {
    const angle = (c / clusterCount) * Math.PI * 2
    const cx = centre + ringRadius * Math.cos(angle)
    const cy = centre + ringRadius * Math.sin(angle)
    for (let k = 0; k < perCluster; k++) {
      const i = c * perCluster + k
      // Uniform disc: sqrt keeps the density flat rather than piling up at the centre.
      const r = clumpRadius * Math.sqrt(Math.random())
      const a = Math.random() * Math.PI * 2
      positions[i * 2] = cx + r * Math.cos(a)
      positions[i * 2 + 1] = cy + r * Math.sin(a)
      fillColor(colors, i, PALETTE[c] ?? [1, 1, 1])
      // Heavy tail: mostly small points with a few large ones to overlap them.
      sizes[i] = 2 + 14 * Math.random() ** 3
      shapes[i] = PointShape.Circle
      clusters[i] = c
    }
  }
  return { positions, colors, sizes, shapes, clusters }
}

/** Builds the floating control panel (layout, stroke sliders, shade mode, background toggle). */
function buildControls (handlers: ControlHandlers): HTMLDivElement {
  const panel = document.createElement('div')
  panel.style.cssText = [
    'position: absolute',
    'top: 16px',
    'right: 16px',
    'z-index: 1000',
    'display: flex',
    'flex-direction: column',
    'gap: 8px',
    'min-width: 220px',
    'padding: 14px 16px',
    'background: rgba(22, 22, 28, 0.85)',
    'border: 1px solid rgba(255, 255, 255, 0.12)',
    'border-radius: 10px',
    'color: #e8e8ec',
    'font: 13px Helvetica, Arial, sans-serif',
    'user-select: none',
  ].join(';')

  const heading = (text: string): HTMLDivElement => {
    const el = document.createElement('div')
    el.textContent = text
    el.style.cssText = 'font-weight: 700; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px;'
    return el
  }

  const divider = (): HTMLDivElement => {
    const el = document.createElement('div')
    el.style.cssText = 'height: 1px; background: rgba(255, 255, 255, 0.12); margin: 4px 0;'
    return el
  }

  // Mutually exclusive choices → radio group.
  const radios = <T extends string>(group: string, options: [string, T][], initial: T, onChange: (value: T) => void): void => {
    for (const [label, value] of options) {
      const row = document.createElement('label')
      row.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer;'
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = group
      input.checked = value === initial
      input.addEventListener('change', () => { if (input.checked) onChange(value) })
      row.append(input, document.createTextNode(label))
      panel.appendChild(row)
    }
  }

  const slider = (
    label: string, min: number, max: number, step: number, value: number, format: (v: number) => string, onChange: (v: number) => void
  ): HTMLLabelElement => {
    const row = document.createElement('label')
    row.style.cssText = 'display: flex; flex-direction: column; gap: 4px; cursor: pointer;'
    const caption = document.createElement('span')
    caption.style.cssText = 'display: flex; justify-content: space-between;'
    const name = document.createElement('span')
    name.textContent = label
    const readout = document.createElement('span')
    readout.style.opacity = '0.7'
    readout.textContent = format(value)
    caption.append(name, readout)
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    input.addEventListener('input', () => {
      const v = Number(input.value)
      readout.textContent = format(v)
      onChange(v)
    })
    row.append(caption, input)
    return row
  }

  panel.appendChild(heading('Layout'))
  radios<Layout>('point-stroke-layout', [['Size grid', 'grid'], ['Overlapping clusters', 'clusters']], 'grid', handlers.onLayoutChange)

  panel.appendChild(divider())
  panel.appendChild(heading('Stroke'))
  panel.appendChild(slider('Width (px)', 0, 3, 0.25, STROKE_WIDTH, v => v.toFixed(2), handlers.onWidthChange))
  panel.appendChild(slider('Lightness step (OKLab ΔL)', 0, 0.4, 0.01, STROKE_INTENSITY, v => v.toFixed(2), handlers.onIntensityChange))

  panel.appendChild(heading('Shade'))
  radios<StrokeMode>('point-stroke-mode', [['Auto (per point lightness)', 'auto'], ['Darken', 'darken'], ['Lighten', 'lighten']], 'auto', handlers.onModeChange)

  panel.appendChild(divider())
  const background = document.createElement('label')
  background.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer;'
  const backgroundInput = document.createElement('input')
  backgroundInput.type = 'checkbox'
  backgroundInput.checked = true
  backgroundInput.addEventListener('change', () => handlers.onBackgroundChange(backgroundInput.checked))
  background.append(backgroundInput, document.createTextNode('Dark background'))
  panel.appendChild(background)

  return panel
}

/**
 * Per-point edge stroke: a thin band along the inside of every point, in a darker or
 * lighter shade of the point's own color. Two layouts: a static size grid, where the
 * sizes ramp shows the small-point cutoff and `scalePointsOnZoom` shows the width holding
 * steady while the points scale, and a simulated set of overlapping clusters, where the
 * stroke has to separate piled-up neighbours of the same color.
 */
export const pointStroke = (): { div: HTMLDivElement; graph: Graph } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const graph = new Graph(div, {
    spaceSize: SPACE_SIZE,
    backgroundColor: DARK_BACKGROUND,
    enableSimulation: false,
    rescalePositions: false,
    // The story frames the view itself (see `applyLayout`).
    fitViewOnInit: false,
    pointStrokeWidth: STROKE_WIDTH,
    pointStrokeIntensity: STROKE_INTENSITY,
    pointStrokeMode: 'auto',
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#ffffff',
    // Cluster layout forces: repulsion weak enough that points still overlap, cluster pull
    // strong enough to keep them piled, gravity strong enough to hold the piles close
    // together, friction and decay set to settle within seconds.
    simulationRepulsion: 0.6,
    simulationCluster: 0.3,
    simulationGravity: 0.8,
    simulationFriction: 0.8,
    simulationDecay: 2000,
    enableDrag: true,
  })
  let currentLayout: Layout = 'grid'

  const applyLayout = (layout: Layout): void => {
    currentLayout = layout
    const data = layout === 'grid' ? buildGridData() : buildClusterData()
    graph.setPointPositions(data.positions)
    graph.setPointColors(data.colors)
    graph.setPointSizes(data.sizes)
    graph.setPointShapes(data.shapes)
    graph.setPointClusters(data.clusters ?? [])
    // Snap: a new layout is a different dataset, not a transition of the old one.
    graph.render(undefined, 0)
    graph.setConfigPartial({
      enableSimulation: layout === 'clusters',
      // Grid sizes are exact pixels; cluster sizes scale with the zoom so the piles can be
      // inspected up close.
      scalePointsOnZoom: layout === 'clusters',
    })
    // Fit from the input positions, not `fitView`: the GPU readback `fitView` uses is empty
    // until the first frame has rendered, so a fit at this point would be a no-op.
    const padding = layout === 'clusters' ? CLUSTER_FIT_PADDING : 0.1
    graph.fitViewByPointPositions(Array.from(data.positions), 0, padding)
  }

  // Clusters contract as they settle; refit once the layout is still. Also fires when
  // switching back to the grid (the simulation is turned off), which must not refit the grid.
  graph.setConfigPartial({
    onSimulationEnd: () => {
      if (currentLayout === 'clusters') graph.fitView(400, CLUSTER_FIT_PADDING)
    },
  })

  applyLayout('grid')

  div.appendChild(buildControls({
    onLayoutChange: applyLayout,
    onWidthChange: width => graph.setConfigPartial({ pointStrokeWidth: width }),
    onIntensityChange: intensity => graph.setConfigPartial({ pointStrokeIntensity: intensity }),
    onModeChange: mode => graph.setConfigPartial({ pointStrokeMode: mode }),
    onBackgroundChange: dark => graph.setConfigPartial({ backgroundColor: dark ? DARK_BACKGROUND : LIGHT_BACKGROUND }),
  }))

  return { div, graph }
}
