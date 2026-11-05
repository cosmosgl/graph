import { Graph, getRgbaColor } from '@cosmos.gl/graph'

type RingColor = 'auto' | 'darken' | 'lighten' | 'white' | '#ff987a'

const POINT_COUNT = 720
// Reserve 30% extra diameter when placing outlined points, leaving their rings room.
const OUTLINE_SPACING_SCALE = 1.3
const BACKGROUND = '#2d313a'
const PALETTE = ['#677ad1', '#a38cde', '#da799b', '#eea575', '#dfc974', '#6cb9a5']

/** Six broad color clusters. Reject placements whose point or outer ring would touch a neighbor. */
function buildData (): { positions: Float32Array; colors: Float32Array; sizes: Float32Array; rings: number[]; overrides: Float32Array } {
  const positions = new Float32Array(POINT_COUNT * 2)
  const colors = new Float32Array(POINT_COUNT * 4)
  const sizes = new Float32Array(POINT_COUNT)
  const overrides = new Float32Array(POINT_COUNT * 4).fill(NaN)
  const rings: number[] = []
  let seed = 163
  const random = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < POINT_COUNT; i++) sizes[i] = 9 + 27 * random() ** 2
  // Place large points first so small points can fill the spaces left between them.
  const order = Array.from({ length: POINT_COUNT }, (_, i) => i).sort((a, b) => (sizes[b] as number) - (sizes[a] as number))
  const placed: number[] = []
  for (const i of order) {
    const group = Math.floor(i / (POINT_COUNT / PALETTE.length))
    const angle = group / PALETTE.length * Math.PI * 2 + 0.3
    const radius = (sizes[i] as number) * (i % 4 === 0 ? OUTLINE_SPACING_SCALE : 1) * 0.5
    let x = 0
    let y = 0
    let overlaps = true
    let attempts = 0
    while (overlaps) {
      // A wider radial band keeps the six curved groups readable without packing them into a rim.
      // Widen a crowded sector gradually rather than retrying inside a full area forever.
      const outerRadius = 460 + Math.floor(attempts++ / 500) * 20
      const distance = Math.sqrt(140 ** 2 + random() * (outerRadius ** 2 - 140 ** 2))
      const direction = angle + (random() - 0.5) * 0.94
      x = 2048 + distance * Math.cos(direction)
      y = 2048 + distance * Math.sin(direction) * 0.85
      overlaps = false
      for (const j of placed) {
        const otherRadius = (sizes[j] as number) * (j % 4 === 0 ? OUTLINE_SPACING_SCALE : 1) * 0.5
        const gap = radius + otherRadius + 5
        const dx = x - (positions[j * 2] as number)
        const dy = y - (positions[j * 2 + 1] as number)
        if (dx * dx + dy * dy < gap * gap) {
          overlaps = true
          break
        }
      }
    }
    positions.set([x, y], i * 2)
    placed.push(i)
    colors.set(getRgbaColor(PALETTE[group] as string), i * 4)
    if (i % 4 === 0) {
      rings.push(i)
      // Half the rings have custom colors; NaN leaves the others on the selected rule.
      if (i % 8 === 0) overrides.set(getRgbaColor(i % 16 === 0 ? '#8fe9ed' : '#fca6c8'), i * 4)
    }
  }
  return { positions, colors, sizes, rings, overrides }
}

/** A single zoomable scatter, using the same floating-panel styling as the other point stories. */
export const ringColors = (): { div: HTMLDivElement; graph: Graph } => {
  const div = document.createElement('div')
  div.style.cssText = 'position:relative;width:100%;height:100vh'
  const data = buildData()
  const graph = new Graph(div, {
    backgroundColor: BACKGROUND,
    enableSimulation: false,
    rescalePositions: false,
    scalePointsOnZoom: true,
    fitViewOnInit: true,
    fitViewDelay: 0,
    fitViewDuration: 0,
    fitViewPadding: 0.18,
    transitionDuration: 0,
    attribution: '',
    outlinedPointIndices: data.rings,
    outlinedPointRingColor: 'auto',
    outlinedPointRingContrast: 0.16,
  })
  graph.setPointPositions(data.positions)
  graph.setPointColors(data.colors)
  graph.setPointSizes(data.sizes)
  graph.render()

  const panel = document.createElement('div')
  panel.style.cssText = [
    'position:absolute', 'top:16px', 'right:16px', 'z-index:1000',
    'display:flex', 'flex-direction:column', 'gap:12px', 'width:220px',
    'padding:14px 16px', 'background:rgba(22,22,28,0.85)',
    'border:1px solid rgba(255,255,255,0.12)', 'border-radius:10px',
    'color:#e8e8ec', 'font:13px Helvetica,Arial,sans-serif', 'user-select:none',
  ].join(';')
  const heading = document.createElement('div')
  heading.textContent = 'Outline rings'
  heading.style.cssText = 'font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;opacity:0.6'
  const hint = document.createElement('div')
  hint.textContent = '720 points · scroll to zoom · drag to pan'
  hint.style.cssText = 'font-size:12px;line-height:1.4;opacity:0.65'
  panel.append(heading, hint)

  const colorRow = document.createElement('label')
  colorRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px'
  const colorLabel = document.createElement('span')
  colorLabel.textContent = 'Ring color'
  const color = document.createElement('select')
  color.setAttribute('aria-label', 'Ring color')
  const chevron = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">' +
    '<path d="m3 4.5 3 3 3-3" fill="none" stroke="#c8c8d0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  )
  color.style.cssText = [
    'appearance:none', 'box-sizing:border-box', 'width:112px', 'height:32px',
    'margin:0', 'padding:0 30px 0 10px', 'font:inherit', 'line-height:normal', 'color:inherit',
    'background-color:#ffffff08', 'border:1px solid #ffffff26', 'border-radius:4px', 'cursor:pointer',
    `background-image:url("data:image/svg+xml,${chevron}")`,
    'background-repeat:no-repeat', 'background-position:right 10px center', 'background-size:12px',
  ].join(';')
  // Native options stay readable even when the OS renders the menu on a light surface.
  color.style.colorScheme = 'dark'
  const modes: [RingColor, string][] = [
    ['auto', 'Auto'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['white', 'White'], ['#ff987a', 'Coral'],
  ]
  for (const [value, text] of modes) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    color.appendChild(option)
  }
  color.addEventListener('change', () => {
    graph.setConfigPartial({ outlinedPointRingColor: color.value as RingColor })
    updateContrast()
  })
  colorRow.append(colorLabel, color)
  panel.appendChild(colorRow)

  const contrastRow = document.createElement('label')
  contrastRow.style.cssText = 'display:flex;flex-direction:column;gap:6px'
  const caption = document.createElement('span')
  caption.style.cssText = 'display:flex;justify-content:space-between'
  const contrastLabel = document.createElement('span')
  contrastLabel.textContent = 'Contrast'
  const readout = document.createElement('span')
  readout.style.opacity = '0.65'
  readout.textContent = '0.16'
  const contrast = document.createElement('input')
  contrast.type = 'range'
  contrast.setAttribute('aria-label', 'Ring contrast')
  contrast.min = '0'
  contrast.max = '0.4'
  contrast.step = '0.01'
  contrast.value = '0.16'
  contrast.style.cssText = 'width:100%;margin:0;accent-color:#a2ace1'
  contrast.addEventListener('input', () => {
    readout.textContent = Number(contrast.value).toFixed(2)
    graph.setConfigPartial({ outlinedPointRingContrast: Number(contrast.value) })
  })
  const updateContrast = (): void => {
    contrast.disabled = color.value === 'white' || color.value === '#ff987a'
    contrastRow.style.opacity = contrast.disabled ? '0.4' : '1'
  }
  caption.append(contrastLabel, readout)
  contrastRow.append(caption, contrast)
  panel.appendChild(contrastRow)

  const checkbox = (text: string, onChange: (checked: boolean) => void): void => {
    const row = document.createElement('label')
    row.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.style.cssText = 'margin:0;accent-color:#a2ace1'
    input.addEventListener('change', () => onChange(input.checked))
    row.append(input, document.createTextNode(text))
    panel.appendChild(row)
  }
  checkbox('Custom colors', checked => {
    graph.setPointRingColors(checked ? data.overrides : new Float32Array(0))
    graph.render()
  })
  checkbox('Light background', checked => {
    graph.setConfigPartial({ backgroundColor: checked ? '#f4f3f0' : BACKGROUND })
  })
  const reset = document.createElement('button')
  reset.textContent = 'Fit view'
  reset.style.cssText = 'font:inherit;color:inherit;background:#ffffff08;border:1px solid #ffffff26;border-radius:4px;padding:6px;cursor:pointer'
  reset.addEventListener('click', () => graph.fitViewByPointPositions(Array.from(data.positions), 250, 0.18))
  panel.appendChild(reset)
  div.appendChild(panel)
  return { div, graph }
}
