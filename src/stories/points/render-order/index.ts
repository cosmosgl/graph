import { Graph, type GraphConfig } from '@cosmos.gl/graph'

const SPACE_SIZE = 4096
const POINTS_NUMBER = 3000
const MIN_SIZE = 12
const MAX_SIZE = 44

interface PointGroup {
  name: string;
  color: [number, number, number];
}

const pointGroups: PointGroup[] = [
  { name: 'Blue', color: [0.373, 0.412, 0.871] },
  { name: 'Coral', color: [0.871, 0.412, 0.373] },
  { name: 'Green', color: [0.373, 0.871, 0.663] },
  { name: 'Amber', color: [0.871, 0.796, 0.373] },
]

interface OrderPreset {
  label: string;
  order: ArrayLike<number> | null;
}

/**
 * `setPointRenderOrder` changes which points are drawn on top without touching point
 * indices. Four overlapping groups of large points are interleaved by index
 * (point `i` belongs to group `i % 4`), so the default index order mixes all four colors.
 *
 * - A group preset passes only that group's indices: a partial order puts the listed
 *   points on top and keeps every other point underneath, in index order.
 * - "Small points on top" and "Reversed index order" pass a full permutation.
 * - Clicking a point appends its index to the current order. An index listed more than
 *   once takes its last position, so the clicked point comes to the front.
 * - Hovering shows the point that picking reports, which is always the one drawn on top.
 * - The options show that the order holds with occlusion culling on or off, with
 *   translucent points, and while a group is highlighted. Highlighted points stay above
 *   greyed-out ones, and the order applies within each group.
 */
export const pointRenderOrder = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  // Deterministic pseudo-random numbers (mulberry32) so the scene is reproducible
  let seed = 7
  const random = (): number => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  // Box–Muller transform: two uniform samples → one gaussian sample
  const randomGaussian = (): number =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())

  const pointPositions = new Float32Array(POINTS_NUMBER * 2)
  const opaqueColors = new Float32Array(POINTS_NUMBER * 4)
  const pointSizes = new Float32Array(POINTS_NUMBER)
  const groupIndices: number[][] = pointGroups.map(() => [])
  for (let i = 0; i < POINTS_NUMBER; i++) {
    const group = i % pointGroups.length
    // Group centers sit close together, so the groups overlap heavily in the middle
    const angle = (2 * Math.PI * group) / pointGroups.length + Math.PI / 4
    const centerX = SPACE_SIZE * (0.5 + 0.05 * Math.cos(angle))
    const centerY = SPACE_SIZE * (0.5 + 0.05 * Math.sin(angle))
    pointPositions[i * 2] = centerX + randomGaussian() * SPACE_SIZE * 0.06
    pointPositions[i * 2 + 1] = centerY + randomGaussian() * SPACE_SIZE * 0.06

    const [r, g, b] = (pointGroups[group] as PointGroup).color
    opaqueColors[i * 4] = r
    opaqueColors[i * 4 + 1] = g
    opaqueColors[i * 4 + 2] = b
    opaqueColors[i * 4 + 3] = 1

    pointSizes[i] = MIN_SIZE + random() * (MAX_SIZE - MIN_SIZE)
    groupIndices[group]?.push(i)
  }

  const translucentColors = new Float32Array(opaqueColors)
  for (let i = 0; i < POINTS_NUMBER; i++) translucentColors[i * 4 + 3] = 0.6

  // Full permutations: biggest points first (bottom), and index order backwards
  const bySizeDescending = Uint32Array.from({ length: POINTS_NUMBER }, (_, i) => i)
    .sort((a, b) => (pointSizes[b] as number) - (pointSizes[a] as number))
  const reversedIndexOrder = Uint32Array.from({ length: POINTS_NUMBER }, (_, i) => POINTS_NUMBER - 1 - i)

  const orderPresets: OrderPreset[] = [
    { label: 'Index order (default)', order: null },
    ...pointGroups.map((group, g): OrderPreset => ({ label: `${group.name} on top`, order: groupIndices[g] ?? [] })),
    { label: 'Small points on top', order: bySizeDescending },
    { label: 'Reversed index order', order: reversedIndexOrder },
  ]

  const highlightedGroup = 2 // Green

  // Floating control panel
  const panel = document.createElement('div')
  panel.style.cssText = [
    'position: absolute',
    'top: 16px',
    'right: 16px',
    'z-index: 1000',
    'display: flex',
    'flex-direction: column',
    'gap: 8px',
    'width: 240px',
    'padding: 14px 16px',
    'background: rgba(22, 22, 28, 0.85)',
    'border: 1px solid rgba(255, 255, 255, 0.12)',
    'border-radius: 10px',
    'color: #e8e8ec',
    'font: 13px Helvetica, Arial, sans-serif',
    'user-select: none',
  ].join(';')
  div.appendChild(panel)

  const heading = (text: string): HTMLDivElement => {
    const el = document.createElement('div')
    el.textContent = text
    el.style.cssText = 'font-weight: 700; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.04em; font-size: 11px;'
    return el
  }
  const note = (): HTMLDivElement => {
    const el = document.createElement('div')
    el.style.cssText = 'opacity: 0.7; font-size: 12px; line-height: 1.35;'
    return el
  }
  const divider = (): HTMLDivElement => {
    const el = document.createElement('div')
    el.style.cssText = 'height: 1px; background: rgba(255, 255, 255, 0.12); margin: 4px 0;'
    return el
  }
  const optionRow = (input: HTMLInputElement, label: string): HTMLLabelElement => {
    const row = document.createElement('label')
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer;'
    row.append(input, document.createTextNode(label))
    return row
  }

  const config: GraphConfig = {
    spaceSize: SPACE_SIZE,
    backgroundColor: '#2d313a',
    pointSizeScale: 1,
    scalePointsOnZoom: false,
    renderLinks: false,
    enableSimulation: false,
    enableDrag: false,
    fitViewOnInit: true,
    renderHoveredPointRing: true,
    hoveredPointRingColor: '#ffffff',
    hoveredPointCursor: 'pointer',
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  let baseOrder: ArrayLike<number> | null = null
  const clickedPoints: number[] = []

  const hoverReadout = note()
  hoverReadout.textContent = 'Hover a point to see which one picking reports.'
  const clickedReadout = note()
  const cullingReadout = note()

  // The graph is created below; these callbacks only run once it exists
  const applyRenderOrder = (): void => {
    // Clicked points go last, so they win over their earlier place in `baseOrder`
    graph.setPointRenderOrder(clickedPoints.length > 0 ? [...Array.from(baseOrder ?? []), ...clickedPoints] : baseOrder)
    graph.render()
    clickedReadout.textContent = clickedPoints.length > 0
      ? `${clickedPoints.length} clicked point${clickedPoints.length > 1 ? 's' : ''} brought to the front.`
      : 'Click a point to bring it to the front.'
  }

  config.onPointClick = (index): void => {
    // A repeat click moves the point to the end rather than counting it twice
    const previous = clickedPoints.indexOf(index)
    if (previous !== -1) clickedPoints.splice(previous, 1)
    clickedPoints.push(index)
    applyRenderOrder()
  }
  config.onPointMouseOver = (index): void => {
    const group = pointGroups[index % pointGroups.length] as PointGroup
    hoverReadout.textContent = `Point #${index} · ${group.name} · ${Math.round(pointSizes[index] as number)} px`
  }
  config.onPointMouseOut = (): void => {
    hoverReadout.textContent = 'Hover a point to see which one picking reports.'
  }

  const graph = new Graph(div, config)
  graph.setPointPositions(pointPositions)
  graph.setPointColors(opaqueColors)
  graph.setPointSizes(pointSizes)
  graph.render()

  // Render order presets (mutually exclusive → radio group)
  panel.appendChild(heading('Render order'))
  for (const [presetIndex, preset] of orderPresets.entries()) {
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'point-render-order-preset'
    input.checked = presetIndex === 0
    input.addEventListener('change', () => {
      if (!input.checked) return
      baseOrder = preset.order
      clickedPoints.length = 0
      applyRenderOrder()
    })
    panel.appendChild(optionRow(input, preset.label))
  }
  panel.appendChild(clickedReadout)

  panel.appendChild(divider())
  panel.appendChild(heading('Options'))

  let isOcclusionCullingOn = true
  let isTranslucent = false
  let isHighlighting = false
  const updateCullingReadout = (): void => {
    // Per-point alpha doesn't switch culling off: translucent points just skip the opaque core pass
    const isActive = isOcclusionCullingOn && !isHighlighting
    cullingReadout.textContent = `Occlusion culling is ${isActive ? 'active' : 'inactive'} (highlighting turns it off; translucent points skip it).`
  }

  const cullingInput = document.createElement('input')
  cullingInput.type = 'checkbox'
  cullingInput.checked = isOcclusionCullingOn
  cullingInput.addEventListener('change', () => {
    isOcclusionCullingOn = cullingInput.checked
    graph.setConfigPartial({ pointOcclusionCulling: isOcclusionCullingOn })
    updateCullingReadout()
  })
  panel.appendChild(optionRow(cullingInput, 'Occlusion culling'))

  const translucentInput = document.createElement('input')
  translucentInput.type = 'checkbox'
  translucentInput.addEventListener('change', () => {
    isTranslucent = translucentInput.checked
    graph.setPointColors(isTranslucent ? translucentColors : opaqueColors)
    graph.render()
    updateCullingReadout()
  })
  panel.appendChild(optionRow(translucentInput, 'Translucent points'))

  const highlightInput = document.createElement('input')
  highlightInput.type = 'checkbox'
  highlightInput.addEventListener('change', () => {
    isHighlighting = highlightInput.checked
    graph.setConfigPartial({
      highlightedPointIndices: isHighlighting ? groupIndices[highlightedGroup] : undefined,
    })
    updateCullingReadout()
  })
  panel.appendChild(optionRow(highlightInput, `Highlight the ${(pointGroups[highlightedGroup] as PointGroup).name} group`))
  panel.appendChild(cullingReadout)

  panel.appendChild(divider())
  panel.appendChild(hoverReadout)

  applyRenderOrder()
  updateCullingReadout()

  return { div, graph }
}
