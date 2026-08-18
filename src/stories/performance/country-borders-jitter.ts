import { Graph } from '@cosmos.gl/graph'
import { COUNTRY_BORDER_LINKS } from './country-borders-data'

// Real-world reproduction of the near-field re-sampling jitter: the country
// borders graph (163 countries, 642 border links). Link attraction plus
// gravity pull the whole graph into a clump a few finest-grid cells wide, so
// cell occupancy stays far above the K=8 near-field sampling slots — the
// sustained-confinement condition where the per-tick Monte-Carlo re-sampling
// (src/modules/ForceManyBody/) shows up as visible shimmer instead of
// annealing away.
//
// Alpha is held ≈ 1 (simulationDecay 1e12) so the effect persists for
// inspection; with the default decay the same noise is present but shrinks
// with alpha as the layout cools. The meter above the graph reports, over a
// sliding window: mean per-tick step of every point, the mean angle between
// consecutive steps (smooth flow → small; re-sampling noise → tens of
// degrees), and finest-cell occupancy versus the 8 sampling slots.

const SEED = 42
const SPACE = 4096
const METER_WINDOW = 120 // ticks

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const parseLinks = (): { codes: string[]; links: Float32Array } => {
  const codes: string[] = []
  const indexOf = new Map<string, number>()
  const pairs = COUNTRY_BORDER_LINKS.trim().split(/\s+/)
  const links = new Float32Array(pairs.length * 2)
  for (const [i, pair] of pairs.entries()) {
    const [source, target] = pair!.split('-') as [string, string]
    for (const code of [source, target]) {
      if (!indexOf.has(code)) {
        indexOf.set(code, codes.length)
        codes.push(code)
      }
    }
    links[i * 2] = indexOf.get(source)!
    links[i * 2 + 1] = indexOf.get(target)!
  }
  return { codes, links }
}

export const countryBordersJitter = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const outer = document.createElement('div')
  outer.style.cssText = 'height:100vh;width:100%;background:#1a1d23;color:#e0e0e0;font-family:monospace;display:flex;flex-direction:column;overflow:hidden;'

  const meter = document.createElement('div')
  meter.style.cssText = 'padding:10px 16px;font-size:12px;line-height:1.6;flex:none;white-space:pre-wrap;'
  meter.textContent = 'Warming up…'
  outer.appendChild(meter)

  const host = document.createElement('div')
  host.style.cssText = 'flex:1;min-height:200px;'
  outer.appendChild(host)

  const { codes, links } = parseLinks()
  const n = codes.length

  const rng = mulberry32(SEED)
  const positions = new Float32Array(n * 2)
  for (let i = 0; i < n; i += 1) {
    positions[i * 2] = SPACE * (0.25 + rng() * 0.5)
    positions[i * 2 + 1] = SPACE * (0.25 + rng() * 0.5)
  }

  // Finest many-body grid for this point count (mirrors ForceManyBody.createLevels).
  const finestGrid = Math.min(512, Math.max(8, 2 ** Math.ceil(Math.log2(2 * Math.sqrt(n)))))
  const cell = SPACE / finestGrid

  // Sliding-window jitter meter fed by tracked positions on every tick.
  let previous: number[] | null = null
  let previousStep: Float32Array | null = null
  const stepWindow: number[] = []
  const turnWindow: number[] = []
  let tick = 0

  const graph = new Graph(host, {
    spaceSize: SPACE,
    fitViewOnInit: true,
    fitViewPadding: 0.3,
    rescalePositions: false,
    randomSeed: SEED,
    pointDefaultSize: 6,
    linkDefaultWidth: 1,
    renderLinks: true,
    // Hold alpha ≈ 1 so the shimmer persists instead of annealing away with the
    // default decay — this is what a long-running / reheated layout experiences.
    simulationDecay: 1e12,
    onSimulationTick: (): void => {
      tick += 1
      const tracked = graph.getTrackedPointPositionsArray()
      if (tracked.length !== n * 2) return
      if (previous) {
        const steps = new Float32Array(n * 2)
        let stepSum = 0
        let turnSum = 0
        let turnCount = 0
        for (let i = 0; i < n; i += 1) {
          const dx = tracked[i * 2]! - previous[i * 2]!
          const dy = tracked[i * 2 + 1]! - previous[i * 2 + 1]!
          steps[i * 2] = dx
          steps[i * 2 + 1] = dy
          const len = Math.hypot(dx, dy)
          stepSum += len
          if (previousStep) {
            const px = previousStep[i * 2]!
            const py = previousStep[i * 2 + 1]!
            const plen = Math.hypot(px, py)
            if (len > 1e-9 && plen > 1e-9) {
              const cos = Math.min(1, Math.max(-1, (dx * px + dy * py) / (len * plen)))
              turnSum += Math.acos(cos) * (180 / Math.PI)
              turnCount += 1
            }
          }
        }
        stepWindow.push(stepSum / n)
        if (turnCount > 0) turnWindow.push(turnSum / turnCount)
        if (stepWindow.length > METER_WINDOW) stepWindow.shift()
        if (turnWindow.length > METER_WINDOW) turnWindow.shift()
        previousStep = steps
      }
      previous = tracked

      if (tick % 15 === 0 && stepWindow.length > 0) {
        // Finest-cell occupancy from the tracked positions
        const counts = new Map<number, number>()
        for (let i = 0; i < n; i += 1) {
          const cx = Math.min(finestGrid - 1, Math.max(0, Math.floor(tracked[i * 2]! / cell)))
          const cy = Math.min(finestGrid - 1, Math.max(0, Math.floor(tracked[i * 2 + 1]! / cell)))
          const key = cy * finestGrid + cx
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        let maxOcc = 0
        let over = 0
        for (const count of counts.values()) {
          if (count > maxOcc) maxOcc = count
          if (count > 8) over += count
        }
        const meanStep = stepWindow.reduce((a, b) => a + b, 0) / stepWindow.length
        const meanTurn = turnWindow.length > 0 ? turnWindow.reduce((a, b) => a + b, 0) / turnWindow.length : 0
        meter.textContent =
          `Country borders: ${n} points, ${links.length / 2} links — alpha held ≈ 1 (decay 1e12)\n` +
          `last ${stepWindow.length} ticks: step ${meanStep.toFixed(2)} u/tick   turn ${meanTurn.toFixed(1)}°   ` +
          `finest cell ${cell.toFixed(0)}²: max occupancy ${maxOcc}, ${((over / n) * 100).toFixed(0)}% of points in >8-slot cells`
      }
    },
  })

  let destroyed = false
  const setup = async (): Promise<void> => {
    await graph.ready
    if (destroyed) return
    graph.setPointPositions(positions, true)
    graph.setLinks(links)
    graph.render()
    graph.trackPointPositionsByIndices(Array.from({ length: n }, (_, i) => i))
    graph.start(1)
    // The layout expands well past the initial positions — re-fit a few times
    // while it finds its equilibrium shape, then leave the camera alone.
    for (const delay of [1500, 3500, 6000]) {
      setTimeout(() => {
        if (!destroyed) graph.fitView(400)
      }, delay)
    }
  }
  // eslint-disable-next-line no-console
  setup().catch((error) => console.error('[country-borders-jitter] failed', error))

  return {
    graph,
    div: outer,
    destroy: (): void => {
      destroyed = true
    },
  }
}
