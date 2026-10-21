import { Graph, GraphConfig } from '@cosmos.gl/graph'
import { COUNTRY_BORDER_LINKS } from './country-borders-data'

// Is a settled layout still? Four graphs that exercise the force paths
// differently run side by side with alpha held at 1, so any motion left at
// equilibrium is the forces' own, not a transient. Each pane reads its
// positions back every tick and reports two numbers over a sliding window:
//
// - motion: RMS displacement per tick, in point spacings (extent / √n) — the
//   metric the many-body history entries use;
// - coherent: the share of that motion shared by neighbours — the energy of
//   per-bin mean displacement over the total. Independent sampling noise
//   scores near 0, a jump along a grid boundary near 1. The eye sees the
//   second and forgives the first, so RMS alone understates ripples.
//
// Each pane also traces one point from its densest cell: a still point reads
// as a dot, drift as a smooth arc, jitter as a tangle — the shape of the motion,
// which no number gives.
//
// The samples picker sets simulationRepulsionSamples on every pane without a
// restart: "auto" leaves it unset, so the engine measures how full the finest
// cells are and picks the count itself; a number fixes it. In these four
// layouts the finest cells hold at most a few points once settled, so every
// count from 8 up samples them exhaustively and the picker changes only what
// a tick costs, not the motion. The count shows on layouts whose cells hold
// more points than it: there too few samples read as per-point jitter in the
// meter and the trail. A restart under a different count forms the layout
// along a different path from the dense start, which changes the traced point
// and its trail without changing the settled motion.
//
// Run it before merging a force change; "Copy results" gives a Markdown table
// for the PR. Public API only.

const SEED = 42
const SPACE = 4096
const WINDOW = 60 // ticks
const TRAIL_WINDOW = 360 // ticks of path kept in the trajectory panel
const TRAIL_PICK_TICK = 180 // pick the traced point once the layout has formed

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
  why: string;
  data: (rng: () => number) => Data;
  config: GraphConfig;
}

const SCENARIOS: Scenario[] = [
  {
    title: '163 points, 642 links — exact all-pairs path',
    why: 'the country-borders graph: small, link-driven, below the grid threshold',
    data: countryBorders,
    config: { pointDefaultSize: 6, linkDefaultWidth: 1 },
  },
  {
    title: '10,000 points, lattice links + collision — grid path',
    why: 'links and collision on the grid path, just above the threshold',
    data: (rng) => lattice(100, 100, rng),
    config: { pointDefaultSize: 3, linkDefaultWidth: 0.5, simulationCollision: 1 },
  },
  {
    title: '22,500 points, 25 clusters — cluster force, repulsion 8, gravity 1.5',
    why: 'the Lasso Selection settings: clustered data under strong repulsion, where the grid shift showed as jitter',
    data: (rng) => clustered(22500, 25, rng),
    config: { pointDefaultSize: 3, simulationRepulsion: 8, simulationGravity: 1.5, simulationCluster: 0.3 },
  },
  {
    title: '100,000 points, uniform blob — repulsion + gravity only',
    why: 'a dense, even layout: where a fixed grid drew a cross along its centre lines',
    data: (rng) => blob(100_000, 200, rng),
    config: { pointDefaultSize: 1.5 },
  },
]

// ── One pane: a graph and its meter ─────────────────────────────────────────

type Pane = {
  element: HTMLDivElement;
  graph: Graph;
  title: string;
  /** Window means, or undefined until the window has filled. */
  results: () => { motion: number; coherent: number; extent: number; ticks: number } | undefined;
  destroy: () => void;
}

const createPane = (scenario: Scenario, holdAlpha: boolean, samples: number | undefined): Pane => {
  const element = document.createElement('div')
  element.style.cssText = 'position:relative;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid #3a3f47;'

  // Right padding leaves room for the trajectory panel in the block's corner
  const header = document.createElement('div')
  header.style.cssText = 'padding:8px 188px 8px 12px;font-size:12px;line-height:1.5;flex:none;'
  const titleLine = document.createElement('div')
  titleLine.style.cssText = 'font-weight:bold;color:#7fd1c0;'
  titleLine.textContent = scenario.title
  const whyLine = document.createElement('div')
  whyLine.style.cssText = 'color:#9aa3ad;'
  whyLine.textContent = scenario.why
  const meter = document.createElement('div')
  meter.textContent = 'warming up…'
  header.append(titleLine, whyLine, meter)
  element.appendChild(header)

  const host = document.createElement('div')
  host.style.cssText = 'flex:1;min-height:0;'
  element.appendChild(host)

  // Top-right corner of the whole block, over the header
  const trailPanel = document.createElement('div')
  trailPanel.style.cssText =
    'position:absolute;top:8px;right:8px;width:160px;background:rgba(26,29,35,0.88);border:1px solid #3a3f47;padding:6px;pointer-events:none;'
  const trailCanvas = document.createElement('canvas')
  trailCanvas.style.cssText = 'display:block;width:148px;height:148px;'
  const trailLabel = document.createElement('div')
  trailLabel.style.cssText = 'margin-top:4px;font-size:10px;line-height:1.4;color:#9aa3ad;'
  trailLabel.textContent = 'trajectory: waiting for the layout to form…'
  trailPanel.append(trailCanvas, trailLabel)
  element.appendChild(trailPanel)

  const { positions, links, clusters } = scenario.data(mulberry32(SEED))
  const n = positions.length / 2
  // Displacement bins for the coherence share: a few points per bin, 2² to 16².
  const bins = Math.min(16, Math.max(2, Math.floor(Math.sqrt(n) / 8)))
  const binSumX = new Float64Array(bins * bins)
  const binSumY = new Float64Array(bins * bins)
  const binCount = new Uint32Array(bins * bins)

  let current: Float32Array<ArrayBufferLike> = new Float32Array(n * 2)
  let previous: Float32Array<ArrayBufferLike> | undefined
  let box = { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  const motionWindow: number[] = []
  const coherentWindow: number[] = []
  let extent = 0
  let tick = 0

  const measure = (): void => {
    current = graph.getPointPositionsArray(current)
    if (current.length !== n * 2) return
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (let i = 0; i < n * 2; i += 2) {
      const x = current[i] as number; const y = current[i + 1] as number
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
    }
    if (previous) {
      // Bin on the previous tick's box so one pass does both sums
      const width = Math.max(box.maxX - box.minX, 1e-9)
      const height = Math.max(box.maxY - box.minY, 1e-9)
      binSumX.fill(0); binSumY.fill(0); binCount.fill(0)
      let energy = 0
      for (let i = 0; i < n; i += 1) {
        const dx = (current[i * 2] as number) - (previous[i * 2] as number)
        const dy = (current[i * 2 + 1] as number) - (previous[i * 2 + 1] as number)
        energy += dx * dx + dy * dy
        const bx = Math.min(bins - 1, Math.max(0, Math.floor(((previous[i * 2] as number) - box.minX) / width * bins)))
        const by = Math.min(bins - 1, Math.max(0, Math.floor(((previous[i * 2 + 1] as number) - box.minY) / height * bins)))
        const b = by * bins + bx
        binSumX[b] = (binSumX[b] as number) + dx
        binSumY[b] = (binSumY[b] as number) + dy
        binCount[b] = (binCount[b] as number) + 1
      }
      let coherentEnergy = 0
      for (let b = 0; b < bins * bins; b += 1) {
        const count = binCount[b] as number
        if (count > 0) coherentEnergy += ((binSumX[b] as number) ** 2 + (binSumY[b] as number) ** 2) / count
      }
      extent = Math.max(maxX - minX, maxY - minY)
      const spacing = extent / Math.sqrt(n)
      motionWindow.push(spacing > 0 ? Math.sqrt(energy / n) / spacing : 0)
      coherentWindow.push(energy > 0 ? coherentEnergy / energy : 0)
      if (motionWindow.length > WINDOW) motionWindow.shift()
      if (coherentWindow.length > WINDOW) coherentWindow.shift()
    }
    box = { minX, minY, maxX, maxY }
    const swap: Float32Array<ArrayBufferLike> = previous ?? new Float32Array(n * 2)
    previous = current
    current = swap
  }

  // ── The traced point ──
  let tracedIndex = -1
  const trail: number[] = []

  /** A point from the fullest coherence bin of the current positions (`previous` after measure). */
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
    ctx.strokeStyle = '#9aa3ad'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(10, size - 10.5)
    ctx.lineTo(10 + barUnits * scale, size - 10.5)
    ctx.stroke()
    ctx.fillStyle = '#9aa3ad'
    ctx.font = '10px monospace'
    ctx.fillText(`${barUnits} u`, 12, size - 15)

    trailLabel.textContent = `point ${tracedIndex}, last ${trail.length / 2} ticks: path spans ${span.toFixed(2)} u`
  }

  const traceStep = (): void => {
    if (!previous) return
    if (tracedIndex < 0 && tick >= TRAIL_PICK_TICK) tracedIndex = pickFromDensestBin()
    if (tracedIndex < 0) return
    trail.push(previous[tracedIndex * 2] as number, previous[tracedIndex * 2 + 1] as number)
    if (trail.length > TRAIL_WINDOW * 2) trail.splice(0, trail.length - TRAIL_WINDOW * 2)
    drawTrail()
  }

  const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length

  const results = (): ReturnType<Pane['results']> => {
    if (motionWindow.length < WINDOW) return undefined
    return { motion: mean(motionWindow), coherent: mean(coherentWindow), extent, ticks: tick }
  }

  const config: GraphConfig = {
    spaceSize: SPACE,
    fitViewOnInit: true,
    fitViewPadding: 0.2,
    rescalePositions: false,
    renderLinks: links !== undefined,
    randomSeed: SEED,
    // Alpha held: what a long-running or reheated layout experiences. Stock
    // decay anneals any force noise away, which is also worth seeing.
    ...(holdAlpha ? { simulationDecay: 1e12 } : {}),
    simulationRepulsionSamples: samples,
    ...scenario.config,
    onSimulationTick: (): void => {
      tick += 1
      measure()
      traceStep()
      if (tick % 10 === 0) {
        const r = results()
        meter.textContent = r
          ? `motion ${r.motion.toFixed(4)} spacings/tick · coherent ${r.coherent.toFixed(2)} · extent ${r.extent.toFixed(0)} · tick ${r.ticks}`
          : `tick ${tick}: filling the ${WINDOW}-tick window…`
      }
    },
  }

  const graph = new Graph(host, config)
  let destroyed = false
  const timers: number[] = []
  const setup = async (): Promise<void> => {
    await graph.ready
    if (destroyed) return
    graph.setPointPositions(positions)
    if (links) graph.setLinks(links)
    if (clusters) graph.setPointClusters(clusters)
    graph.render()
    graph.start(1)
    // Re-fit while the layout finds its shape, then leave the camera alone
    for (const delay of [1500, 4000, 8000]) {
      timers.push(window.setTimeout(() => { if (!destroyed) graph.fitView(400) }, delay))
    }
  }
  // eslint-disable-next-line no-console
  setup().catch((error) => console.error('[steady-state-motion] failed', error))

  return {
    element,
    graph,
    title: scenario.title,
    results,
    destroy: (): void => {
      destroyed = true
      for (const timer of timers) window.clearTimeout(timer)
    },
  }
}

// ── The story ───────────────────────────────────────────────────────────────

export const steadyStateMotion = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const outer = document.createElement('div')
  outer.style.cssText = 'height:100vh;width:100%;background:#1a1d23;color:#e0e0e0;font-family:monospace;display:flex;flex-direction:column;overflow:hidden;'

  const bar = document.createElement('div')
  bar.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 12px;font-size:12px;flex:none;border-bottom:1px solid #3a3f47;'
  outer.appendChild(bar)

  const grid = document.createElement('div')
  grid.style.cssText = 'flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;'
  outer.appendChild(grid)

  let holdAlpha = true
  let paused = false
  let panes: Pane[] = []

  const addButton = (label: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement('button')
    button.textContent = label
    button.style.cssText = 'font:inherit;padding:4px 10px;background:#2a2f37;color:#e0e0e0;border:1px solid #3a3f47;cursor:pointer;'
    button.addEventListener('click', onClick)
    bar.appendChild(button)
    return button
  }

  const pauseButton = addButton('Pause', () => {
    paused = !paused
    pauseButton.textContent = paused ? 'Resume' : 'Pause'
    for (const pane of panes) {
      if (paused) pane.graph.pause()
      else pane.graph.start(1)
    }
  })

  const mount = (): void => {
    for (const pane of panes) {
      pane.destroy()
      pane.graph.destroy()
    }
    grid.innerHTML = ''
    panes = SCENARIOS.map((scenario) => createPane(scenario, holdAlpha, samples()))
    for (const pane of panes) grid.appendChild(pane.element)
    paused = false
    pauseButton.textContent = 'Pause'
  }

  addButton('Restart', mount)
  addButton('Fit all', () => { for (const pane of panes) pane.graph.fitView(400) })

  const hold = document.createElement('label')
  hold.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer;'
  const holdBox = document.createElement('input')
  holdBox.type = 'checkbox'
  holdBox.checked = holdAlpha
  holdBox.addEventListener('change', () => {
    holdAlpha = holdBox.checked
    mount()
  })
  hold.append(holdBox, document.createTextNode('hold alpha at 1 (off: stock decay, the layout settles and stops)'))
  bar.appendChild(hold)

  // Applies on the next tick, so the meters show the change in place
  const samplesLabel = document.createElement('label')
  samplesLabel.style.cssText = 'display:flex;gap:6px;align-items:center;cursor:pointer;'
  const samplesSelect = document.createElement('select')
  samplesSelect.style.cssText = 'font:inherit;padding:3px 6px;background:#2a2f37;color:#e0e0e0;border:1px solid #3a3f47;'
  for (const value of ['auto', '8', '16', '32', '64']) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = value
    samplesSelect.appendChild(option)
  }
  const samples = (): number | undefined => samplesSelect.value === 'auto' ? undefined : Number(samplesSelect.value)
  samplesSelect.addEventListener('change', () => {
    for (const pane of panes) pane.graph.setConfigPartial({ simulationRepulsionSamples: samples() })
  })
  samplesLabel.append(document.createTextNode('samples'), samplesSelect)
  bar.appendChild(samplesLabel)

  const status = document.createElement('span')
  status.style.cssText = 'color:#9aa3ad;margin-left:auto;'
  bar.appendChild(status)
  addButton('Copy results', () => {
    const rows = panes.map((pane) => {
      const r = pane.results()
      return r
        ? `| ${pane.title} | ${r.motion.toFixed(4)} | ${r.coherent.toFixed(2)} | ${r.extent.toFixed(0)} | ${r.ticks} |`
        : `| ${pane.title} | window not filled | | | |`
    })
    const table = [
      `| scenario (alpha ${holdAlpha ? 'held at 1' : 'stock decay'}, samples ${samplesSelect.value}, last ${WINDOW} ticks) ` +
        '| motion, spacings/tick | coherent share | extent | tick |',
      '|---|---|---|---|---|',
      ...rows,
    ].join('\n')
    navigator.clipboard.writeText(table).then(
      () => { status.textContent = 'copied as Markdown' },
      () => { status.textContent = 'clipboard unavailable — see console'; console.log(table) } // eslint-disable-line no-console
    )
  })

  mount()

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
