import { Graph, GraphConfig, type RepulsionQuality } from '@cosmos.gl/graph'
import { COUNTRY_BORDER_LINKS } from './country-borders-data'

// Is a settled layout still? Four graphs that exercise the force paths
// differently run side by side with alpha held at 1, so any motion left at
// equilibrium is the forces' own, not a transient. Each pane traces one point
// from its densest cell: a still point reads as a dot, drift as a smooth arc,
// jitter as a tangle — the shape of the motion, which no number gives.
//
// The far-field switch applies `simulationRepulsionQuality` to all four panes
// live: on `auto` the 22,500-point clusters run the precise shell and the 100k
// blob the fast one, and each pane's header says which; forcing either shows
// what the setting trades.
//
// Run it before merging a force change. Public API only.

const SEED = 42
const SPACE = 4096
const TRAIL_WINDOW = 360 // ticks of path kept in the trajectory panel
const FORMED_TICK = 180 // the layout has formed: fit the view once and pick the traced point
// Mirrors the documented tiers of the many-body force, so a pane can say which
// far field it runs; the engine does not expose the resolved value. Up to 4,096
// points there is no far field: every pair is summed exactly, whatever the key.
const ALL_PAIRS_UP_TO = 4_096
const PRECISE_UP_TO = 25_000

/** What the many-body force runs for a pane of n points at the given quality. */
const describeFarField = (quality: RepulsionQuality, n: number): string =>
  (n <= ALL_PAIRS_UP_TO ? 'all pairs' : quality === 'auto' ? `auto · ${n <= PRECISE_UP_TO ? 'precise' : 'fast'}` : quality)

const TEXT = '#e0e0e0'
const MUTED = '#9aa3ad'
const LINE = '#2e333b'

// ── Seeded data ─────────────────────────────────────────────────────────────

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

type Data = { positions: Float32Array; links?: Float32Array; clusters?: number[] }

/** Points in the middle 1% of the space, the way the mesh stories start. */
const tightSquare = (n: number, rng: () => number): Float32Array => {
  const positions = new Float32Array(n * 2)
  for (let i = 0; i < n; i += 1) {
    positions[i * 2] = SPACE * (0.495 + rng() * 0.01)
    positions[i * 2 + 1] = SPACE * (0.495 + rng() * 0.01)
  }
  return positions
}

const countryBorders = (rng: () => number): Data => {
  const indexOf = new Map<string, number>()
  const pairs = COUNTRY_BORDER_LINKS.trim().split(/\s+/)
  const links = new Float32Array(pairs.length * 2)
  for (const [i, pair] of pairs.entries()) {
    const [source, target] = pair!.split('-') as [string, string]
    for (const code of [source, target]) {
      if (!indexOf.has(code)) indexOf.set(code, indexOf.size)
    }
    links[i * 2] = indexOf.get(source)!
    links[i * 2 + 1] = indexOf.get(target)!
  }
  const n = indexOf.size
  const positions = new Float32Array(n * 2)
  for (let i = 0; i < n; i += 1) {
    positions[i * 2] = SPACE * (0.25 + rng() * 0.5)
    positions[i * 2 + 1] = SPACE * (0.25 + rng() * 0.5)
  }
  return { positions, links }
}

/** An n × m lattice: every point linked to its right and lower neighbour. */
const lattice = (n: number, m: number, rng: () => number): Data => {
  const links: number[] = []
  for (let i = 0; i < n * m; i += 1) {
    if ((i + 1) % n !== 0) links.push(i, i + 1)
    if (i + n < n * m) links.push(i, i + n)
  }
  return { positions: tightSquare(n * m, rng), links: new Float32Array(links) }
}

const clustered = (n: number, clusterCount: number, rng: () => number): Data => ({
  positions: tightSquare(n, rng),
  clusters: Array.from({ length: n }, (_, i) => i % clusterCount),
})

const blob = (n: number, radius: number, rng: () => number): Data => {
  const positions = new Float32Array(n * 2)
  for (let i = 0; i < n; i += 1) {
    const angle = rng() * 2 * Math.PI
    const r = Math.sqrt(rng()) * radius
    positions[i * 2] = SPACE / 2 + Math.cos(angle) * r
    positions[i * 2 + 1] = SPACE / 2 + Math.sin(angle) * r
  }
  return { positions }
}

// ── The four scenarios ──────────────────────────────────────────────────────

type Scenario = {
  title: string;
  data: (rng: () => number) => Data;
  config: GraphConfig;
}

// The country-borders graph runs the exact all-pairs path; the other three run
// the grid path: a linked lattice with collision, the Lasso Selection settings
// (clustered data under strong repulsion, where the grid shift showed as
// jitter) and a dense even blob, where a fixed grid drew a cross.
const SCENARIOS: Scenario[] = [
  {
    title: '163 points · 642 links',
    data: countryBorders,
    config: { pointDefaultSize: 6, linkDefaultWidth: 1 },
  },
  {
    title: '10,000 points · lattice · collision',
    data: (rng) => lattice(100, 100, rng),
    config: { pointDefaultSize: 3, linkDefaultWidth: 0.5, simulationCollision: 1 },
  },
  {
    title: '22,500 points · 25 clusters · repulsion 8',
    data: (rng) => clustered(22500, 25, rng),
    config: { pointDefaultSize: 3, simulationRepulsion: 8, simulationGravity: 1.5, simulationCluster: 0.3 },
  },
  {
    title: '100,000 points · blob',
    data: (rng) => blob(100_000, 200, rng),
    config: { pointDefaultSize: 1.5 },
  },
]

// ── One pane: a graph and its trajectory ────────────────────────────────────

type Pane = {
  element: HTMLDivElement;
  graph: Graph;
  /** Applies the far-field setting live; the next step uses it. */
  setQuality: (quality: RepulsionQuality) => void;
  destroy: () => void;
}

const createPane = (scenario: Scenario, quality: RepulsionQuality): Pane => {
  const element = document.createElement('div')
  element.style.cssText = `position:relative;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid ${LINE};`

  // One line; the right padding leaves room for the trajectory panel in the corner
  const header = document.createElement('div')
  header.style.cssText = 'display:flex;gap:8px;align-items:center;padding:6px 176px 6px 10px;font-size:12px;line-height:1.4;flex:none;'
  const titleLine = document.createElement('span')
  titleLine.style.cssText = `color:${TEXT};`
  titleLine.textContent = scenario.title
  const farFieldTag = document.createElement('span')
  farFieldTag.style.cssText = `font-size:10px;padding:1px 7px;border:1px solid ${LINE};border-radius:999px;color:${MUTED};white-space:nowrap;`
  header.append(titleLine, farFieldTag)
  element.appendChild(header)

  const host = document.createElement('div')
  host.style.cssText = 'flex:1;min-height:0;'
  element.appendChild(host)

  // Top-right corner of the whole block, over the header
  const trailPanel = document.createElement('div')
  trailPanel.style.cssText =
    `position:absolute;top:8px;right:8px;width:160px;background:rgba(26,29,35,0.88);border:1px solid ${LINE};padding:6px;pointer-events:none;`
  const trailCanvas = document.createElement('canvas')
  trailCanvas.style.cssText = 'display:block;width:148px;height:148px;'
  const trailLabel = document.createElement('div')
  trailLabel.style.cssText = `margin-top:4px;font-size:10px;line-height:1.4;color:${MUTED};`
  trailLabel.textContent = 'one point, waiting for the layout…'
  trailPanel.append(trailCanvas, trailLabel)
  element.appendChild(trailPanel)

  const { positions, links, clusters } = scenario.data(mulberry32(SEED))
  const n = positions.length / 2
  farFieldTag.textContent = describeFarField(quality, n)
  // Bins for picking the traced point from the densest cell: a few points per bin, 2² to 16².
  const bins = Math.min(16, Math.max(2, Math.floor(Math.sqrt(n) / 8)))

  let current: Float32Array<ArrayBufferLike> = new Float32Array(n * 2)
  let previous: Float32Array<ArrayBufferLike> | undefined
  let box = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let tick = 0

  /** Reads this tick's positions back and keeps their bounding box for the bin pick. */
  const measure = (): void => {
    current = graph.getPointPositionsArray(current)
    if (current.length !== n * 2) return
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (let i = 0; i < n * 2; i += 2) {
      const x = current[i] as number; const y = current[i + 1] as number
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
    box = { minX, minY, maxX, maxY }
    const swap: Float32Array<ArrayBufferLike> = previous ?? new Float32Array(n * 2)
    previous = current
    current = swap
  }

  // ── The traced point ──
  let tracedIndex = -1
  const trail: number[] = []

  /** A point from the fullest bin of the current positions (`previous` after measure). */
  const pickFromDensestBin = (): number => {
    if (!previous) return 0
    const width = Math.max(box.maxX - box.minX, 1e-9)
    const height = Math.max(box.maxY - box.minY, 1e-9)
    const counts = new Uint32Array(bins * bins)
    const binOf = (i: number): number => {
      const bx = Math.min(bins - 1, Math.max(0, Math.floor(((previous![i * 2] as number) - box.minX) / width * bins)))
      const by = Math.min(bins - 1, Math.max(0, Math.floor(((previous![i * 2 + 1] as number) - box.minY) / height * bins)))
      return by * bins + bx
    }
    for (let i = 0; i < n; i += 1) counts[binOf(i)] = (counts[binOf(i)] as number) + 1
    let best = 0
    for (let b = 1; b < counts.length; b += 1) if ((counts[b] as number) > (counts[best] as number)) best = b
    for (let i = 0; i < n; i += 1) if (binOf(i) === best) return i
    return 0
  }

  const niceUnits = (target: number): number => {
    const pow = 10 ** Math.floor(Math.log10(target))
    for (const mult of [5, 2, 1]) if (mult * pow <= target) return mult * pow
    return pow
  }

  const drawTrail = (): void => {
    const ctx = trailCanvas.getContext('2d')
    if (!ctx || trail.length < 4) return
    const size = 148
    const dpr = window.devicePixelRatio || 1
    if (trailCanvas.width !== size * dpr) {
      trailCanvas.width = size * dpr
      trailCanvas.height = size * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)

    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity
    for (let i = 0; i < trail.length; i += 2) {
      minX = Math.min(minX, trail[i]!); maxX = Math.max(maxX, trail[i]!)
      minY = Math.min(minY, trail[i + 1]!); maxY = Math.max(maxY, trail[i + 1]!)
    }
    const span = Math.max(maxX - minX, maxY - minY)
    // Auto-fit, but never closer than 1 unit across the panel: a still point
    // must read as a dot, not be inflated into a false tangle.
    const scale = (size - 24) / Math.max(span, 1)
    const midX = (minX + maxX) / 2
    const midY = (minY + maxY) / 2
    const toX = (x: number): number => size / 2 + (x - midX) * scale
    const toY = (y: number): number => size / 2 - (y - midY) * scale

    ctx.lineWidth = 1.5
    for (let i = 2; i < trail.length; i += 2) {
      ctx.strokeStyle = `rgba(233,161,59,${(0.15 + 0.85 * (i / trail.length)).toFixed(3)})`
      ctx.beginPath()
      ctx.moveTo(toX(trail[i - 2]!), toY(trail[i - 1]!))
      ctx.lineTo(toX(trail[i]!), toY(trail[i + 1]!))
      ctx.stroke()
    }
    ctx.fillStyle = '#f3c063'
    ctx.beginPath()
    ctx.arc(toX(trail[trail.length - 2]!), toY(trail[trail.length - 1]!), 3, 0, Math.PI * 2)
    ctx.fill()

    const barUnits = niceUnits((0.4 * size) / scale)
    ctx.strokeStyle = MUTED
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(10, size - 10.5)
    ctx.lineTo(10 + barUnits * scale, size - 10.5)
    ctx.stroke()
    ctx.fillStyle = MUTED
    ctx.font = '10px monospace'
    ctx.fillText(`${barUnits} u`, 12, size - 15)
  }

  const traceStep = (): void => {
    if (!previous) return
    if (tracedIndex < 0 && tick >= FORMED_TICK) {
      // One fit, on the formed layout; the seed fit before it only frames the start.
      graph.fitView(600)
      tracedIndex = pickFromDensestBin()
      trailLabel.textContent = `one point, last ${TRAIL_WINDOW} ticks`
    }
    if (tracedIndex < 0) return
    trail.push(previous[tracedIndex * 2] as number, previous[tracedIndex * 2 + 1] as number)
    if (trail.length > TRAIL_WINDOW * 2) trail.splice(0, trail.length - TRAIL_WINDOW * 2)
    drawTrail()
  }

  const config: GraphConfig = {
    spaceSize: SPACE,
    fitViewOnInit: true,
    fitViewPadding: 0.2,
    rescalePositions: false,
    renderLinks: links !== undefined,
    randomSeed: SEED,
    // Alpha held at 1: what a long-running or reheated layout experiences.
    // Stock decay would anneal any force noise away within a minute.
    simulationDecay: 1e12,
    simulationRepulsionQuality: quality,
    ...scenario.config,
    onSimulationTick: (): void => {
      tick += 1
      measure()
      traceStep()
    },
  }

  const graph = new Graph(host, config)
  let destroyed = false
  const setup = async (): Promise<void> => {
    await graph.ready
    if (destroyed) return
    graph.setPointPositions(positions)
    if (links) graph.setLinks(links)
    if (clusters) graph.setPointClusters(clusters)
    graph.render()
    graph.start(1)
  }
  // eslint-disable-next-line no-console
  setup().catch((error) => console.error('[steady-state-motion] failed', error))

  return {
    element,
    graph,
    setQuality: (next: RepulsionQuality): void => {
      graph.setConfigPartial({ simulationRepulsionQuality: next })
      farFieldTag.textContent = describeFarField(next, n)
    },
    destroy: (): void => {
      destroyed = true
    },
  }
}

// ── The story ───────────────────────────────────────────────────────────────

export const steadyStateMotion = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const outer = document.createElement('div')
  outer.style.cssText = 'height:100vh;width:100%;background:#1a1d23;color:#e0e0e0;font-family:monospace;display:flex;flex-direction:column;overflow:hidden;'

  const bar = document.createElement('div')
  bar.style.cssText = `display:flex;gap:20px;align-items:center;padding:6px 12px;font-size:12px;flex:none;border-bottom:1px solid ${LINE};color:${MUTED};`
  outer.appendChild(bar)

  const grid = document.createElement('div')
  grid.style.cssText = 'flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;'
  outer.appendChild(grid)

  let quality: RepulsionQuality = 'auto'
  const panes: Pane[] = SCENARIOS.map((scenario) => createPane(scenario, quality))
  for (const pane of panes) grid.appendChild(pane.element)

  // simulationRepulsionQuality as three buttons, applied to every pane without a restart
  const farField = document.createElement('div')
  farField.style.cssText = 'display:flex;gap:8px;align-items:center;'
  farField.append(document.createTextNode('far field'))
  const segments = document.createElement('div')
  segments.style.cssText = `display:inline-flex;border:1px solid ${LINE};border-radius:6px;overflow:hidden;`
  const buttons = (['auto', 'precise', 'fast'] as const).map((option) => {
    const button = document.createElement('button')
    button.textContent = option
    button.style.cssText = 'font:inherit;padding:3px 10px;background:transparent;border:0;cursor:pointer;'
    button.addEventListener('click', () => {
      quality = option
      for (const pane of panes) pane.setQuality(quality)
      paint()
    })
    segments.appendChild(button)
    return { option, button }
  })
  const paint = (): void => {
    for (const { option, button } of buttons) {
      const active = option === quality
      button.style.background = active ? LINE : 'transparent'
      button.style.color = active ? TEXT : MUTED
    }
  }
  paint()
  farField.appendChild(segments)
  bar.appendChild(farField)

  return {
    // The story contract destroys this one; the other three are ours
    graph: panes[0]!.graph,
    div: outer,
    destroy: (): void => {
      for (const [i, pane] of panes.entries()) {
        pane.destroy()
        if (i > 0) pane.graph.destroy()
      }
    },
  }
}
