import { Graph, type GraphConfig } from '@cosmos.gl/graph'

const SPACE_SIZE = 4096
const POINTS_NUMBER = 200_000
const CLUSTERS_NUMBER = 12
const TRANSLUCENT_POINTS_SHARE = 0.3

const palette: [number, number, number][] = [
  [0.373, 0.412, 0.871], // #5f69de
  [0.871, 0.412, 0.373], // #de695f
  [0.373, 0.871, 0.663], // #5fdea9
  [0.871, 0.796, 0.373], // #decb5f
  [0.663, 0.373, 0.871], // #a95fde
]

/**
 * Heavy-overdraw scene: many large opaque points packed into a few gaussian
 * clusters, so most fragments are hidden underneath other points. Toggle the
 * `pointOcclusionCulling` config option and watch the FPS monitor to see the
 * effect of depth-based occlusion culling. The "translucent points" toggle
 * gives a share of the points a semi-transparent color to demonstrate that
 * mixed-alpha scenes still blend correctly in stacking order.
 */
export const pointOcclusionCulling = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const div = document.createElement('div')
  div.style.height = '100vh'
  div.style.width = '100%'
  div.style.position = 'relative'

  const buttonStyle = (top: number): string => [
    'position: absolute',
    `top: ${top}px`,
    'left: 12px',
    'z-index: 1000',
    'padding: 6px 16px',
    'font: 600 13px Helvetica, Arial, sans-serif',
    'color: #fff',
    'background: #5f69de',
    'border: none',
    'border-radius: 15px',
    'cursor: pointer',
    'opacity: 0.9',
  ].join(';')

  const occlusionButton = document.createElement('button')
  occlusionButton.style.cssText = buttonStyle(12)
  div.appendChild(occlusionButton)

  const translucencyButton = document.createElement('button')
  translucencyButton.textContent = 'Translucent points: Off'
  translucencyButton.style.cssText = buttonStyle(48)
  div.appendChild(translucencyButton)

  // Deterministic pseudo-random numbers (mulberry32) so the scene is reproducible
  let seed = 42
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
  for (let i = 0; i < POINTS_NUMBER; i++) {
    const cluster = i % CLUSTERS_NUMBER
    const angle = (2 * Math.PI * cluster) / CLUSTERS_NUMBER
    const centerX = SPACE_SIZE * (0.5 + 0.3 * Math.cos(angle))
    const centerY = SPACE_SIZE * (0.5 + 0.3 * Math.sin(angle))
    pointPositions[i * 2] = centerX + randomGaussian() * SPACE_SIZE * 0.05
    pointPositions[i * 2 + 1] = centerY + randomGaussian() * SPACE_SIZE * 0.05

    const [r, g, b] = palette[cluster % palette.length] as [number, number, number]
    opaqueColors[i * 4] = r
    opaqueColors[i * 4 + 1] = g
    opaqueColors[i * 4 + 2] = b
    opaqueColors[i * 4 + 3] = 1
  }

  // Same palette, but a share of the points gets a semi-transparent alpha
  const mixedColors = new Float32Array(opaqueColors)
  for (let i = 0; i < POINTS_NUMBER; i++) {
    if (random() < TRANSLUCENT_POINTS_SHARE) mixedColors[i * 4 + 3] = 0.4
  }

  const config: GraphConfig = {
    spaceSize: SPACE_SIZE,
    backgroundColor: '#2d313a',
    pointDefaultSize: 30,
    pointSizeScale: 1,
    scalePointsOnZoom: false,
    renderLinks: false,
    enableSimulation: false,
    enableDrag: false,
    fitViewOnInit: true,
    showFPSMonitor: true,
    attribution: 'visualized with <a href="https://cosmograph.app/" style="color: var(--cosmosgl-attribution-color);" target="_blank">Cosmograph</a>',
  }

  const graph = new Graph(div, config)

  graph.setPointPositions(pointPositions)
  graph.setPointColors(opaqueColors)
  graph.render()

  // Cycle through the three pointOcclusionCulling states
  const occlusionStates: { value: boolean | undefined; label: string }[] = [
    { value: undefined, label: 'Occlusion culling: Auto' },
    { value: false, label: 'Occlusion culling: Off' },
    { value: true, label: 'Occlusion culling: Forced' },
  ]
  let occlusionStateIndex = 0
  const applyOcclusionState = (): void => {
    const state = occlusionStates[occlusionStateIndex] as { value: boolean | undefined; label: string }
    graph.setConfigPartial({ pointOcclusionCulling: state.value })
    occlusionButton.textContent = state.label
  }
  applyOcclusionState()
  occlusionButton.addEventListener('click', () => {
    occlusionStateIndex = (occlusionStateIndex + 1) % occlusionStates.length
    applyOcclusionState()
  })

  let translucencyEnabled = false
  translucencyButton.addEventListener('click', () => {
    translucencyEnabled = !translucencyEnabled
    graph.setPointColors(translucencyEnabled ? mixedColors : opaqueColors)
    graph.render()
    translucencyButton.textContent = `Translucent points: ${translucencyEnabled ? 'On' : 'Off'}`
  })

  const destroy = (): void => {
    graph.destroy()
  }

  return { div, graph, destroy }
}
