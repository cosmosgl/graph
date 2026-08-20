import { Graph, GraphConfig } from '@cosmos.gl/graph'
import { ForceManyBody } from '@/graph/modules/ForceManyBody'
import { COUNTRY_BORDER_LINKS } from './country-borders-data'

// What the many-body jitter fix changed, live: the country borders network
// (163 points, 642 links) run twice with identical data, seed, and simulation
// settings. Left is cosmos.gl today — small graphs take the exact all-pairs
// path, and the settled layout is still. Right is how every graph ran before
// the fix — the grid + Monte-Carlo near field with K = 8 sampling slots,
// forced back on here purely for comparison. Each side reports step/turn over
// a sliding window and traces one point from its densest finest cell: a
// smooth drift arc today, a random-walk tangle before.
//
// ⚠ HOW THE FORCING WORKS — READ BEFORE COPYING. The engine deliberately does
// not expose the path choice or the slot count; this story reaches into
// unexported internals (`ForceManyBody`) through the repo's `@/graph` source
// alias and patches two private members at module load. That import only
// resolves inside this repository — none of the patch code works against the
// published package, and any refactor of those internals may break it (the
// patch throws loudly if the members disappear). It exists so the comparison
// is reproducible without engine changes; it is not a supported API.

const SEED = 42
const SPACE = 4096
const METER_WINDOW = 120 // ticks
const TRAIL_WINDOW = 360 // ticks of path history in the trajectory panel
const TRAIL_PICK_TICK = 180 // pick the traced point after the clump has formed

// ── Internals patch (repo-only, see header) ─────────────────────────────────

// Per-instance marker smuggled through the config: applyConfig copies unknown
// keys verbatim onto the merged config object, and every force module holds a
// reference to that object — so the patched members below can tell the two
// twin graphs apart at call time.
const FORCE_SAMPLED_KEY = '__storyForceSampledRepulsion'
// Symbol.for survives HMR re-execution, keeping the patch single-layered.
const PATCH_FLAG = Symbol.for('cosmos.stories.force-sampled-repulsion-patch')

type ForceManyBodyPrivate = {
  config: Record<string, unknown>;
  data: { pointsNumber?: number };
  nearFieldSlots?: number;
}

const patchForceManyBody = (): void => {
  const proto = ForceManyBody.prototype as unknown as Record<PropertyKey, unknown>
  if (proto[PATCH_FLAG]) return

  const usesAllPairs = Object.getOwnPropertyDescriptor(proto, 'usesAllPairs')
  const createSlotTargets = Object.getOwnPropertyDescriptor(proto, 'createNearFieldSlotTargets')
  if (typeof usesAllPairs?.get !== 'function' || typeof createSlotTargets?.value !== 'function') {
    throw new Error('country-borders-comparison: ForceManyBody internals moved — update this story')
  }
  const originalUsesAllPairs = usesAllPairs.get
  const originalCreateSlotTargets = createSlotTargets.value as (...args: unknown[]) => unknown

  // Marked instances always take the grid + sampled near-field path.
  Object.defineProperty(proto, 'usesAllPairs', {
    configurable: true,
    get (this: ForceManyBodyPrivate): boolean {
      if (this.config[FORCE_SAMPLED_KEY]) return false
      return originalUsesAllPairs.call(this) as boolean
    },
  })

  // getNearFieldSlotCount is module-private and can't be patched directly; it
  // reads data.pointsNumber only inside this method, so shadow the getter with
  // a count from its 8-slot tier for the duration of the call.
  Object.defineProperty(proto, 'createNearFieldSlotTargets', {
    configurable: true,
    writable: true,
    value (this: ForceManyBodyPrivate, ...args: unknown[]): unknown {
      if (!this.config[FORCE_SAMPLED_KEY]) return originalCreateSlotTargets.apply(this, args)
      Object.defineProperty(this.data, 'pointsNumber', { value: 100_000, configurable: true })
      try {
        const result = originalCreateSlotTargets.apply(this, args)
        // The pane's "K = 8" header must stay true: fail loudly if the slot
        // tiers are retuned so 100k points no longer maps to 8 slots, or the
        // count stops flowing through data.pointsNumber.
        if (this.nearFieldSlots !== 8) {
          throw new Error(`country-borders-comparison: expected 8 near-field slots, got ${this.nearFieldSlots} — update this story`)
        }
        return result
      } finally {
        delete this.data.pointsNumber
      }
    },
  })

  proto[PATCH_FLAG] = true
}

// ── Shared data ─────────────────────────────────────────────────────────────

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

const parseLinks = (): { count: number; links: Float32Array } => {
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
  return { count: indexOf.size, links }
}

// ── One instrumented pane (graph + meter + trajectory panel) ────────────────

type Pane = {
  element: HTMLDivElement;
  graph: Graph;
  destroy: () => void;
}

const createPane = (title: string, accent: string, forceSampled: boolean): Pane => {
  const pane = document.createElement('div')
  pane.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;'

  const header = document.createElement('div')
  header.style.cssText = 'padding:10px 14px;font-size:12px;line-height:1.6;flex:none;'
  const titleLine = document.createElement('div')
  titleLine.style.cssText = `font-weight:bold;color:${accent};`
  titleLine.textContent = title
  const meter = document.createElement('div')
  meter.textContent = 'Warming up…'
  header.appendChild(titleLine)
  header.appendChild(meter)
  pane.appendChild(header)

  const stage = document.createElement('div')
  stage.style.cssText = 'flex:1;min-height:200px;position:relative;'
  pane.appendChild(stage)

  const host = document.createElement('div')
  host.style.cssText = 'height:100%;'
  stage.appendChild(host)

  const trailPanel = document.createElement('div')
  trailPanel.style.cssText =
    'position:absolute;top:10px;right:10px;width:200px;background:rgba(26,29,35,0.88);border:1px solid #3a3f47;padding:8px;pointer-events:none;'
  const trailCanvas = document.createElement('canvas')
  trailCanvas.style.cssText = 'display:block;width:184px;height:184px;'
  const trailLabel = document.createElement('div')
  trailLabel.style.cssText = 'margin-top:6px;font-size:11px;line-height:1.4;color:#9aa3ad;'
  trailLabel.textContent = 'Trajectory: waiting for the clump to form…'
  trailPanel.appendChild(trailCanvas)
  trailPanel.appendChild(trailLabel)
  stage.appendChild(trailPanel)

  const { count: n, links } = parseLinks()
  const rng = mulberry32(SEED)
  const positions = new Float32Array(n * 2)
  for (let i = 0; i < n; i += 1) {
    positions[i * 2] = SPACE * (0.25 + rng() * 0.5)
    positions[i * 2 + 1] = SPACE * (0.25 + rng() * 0.5)
  }

  // Finest many-body grid for this point count (mirrors ForceManyBody.createLevels).
  const finestGrid = Math.min(512, Math.max(8, 2 ** Math.ceil(Math.log2(2 * Math.sqrt(n)))))
  const cell = SPACE / finestGrid
  const cellOf = (x: number, y: number): number => {
    const cx = Math.min(finestGrid - 1, Math.max(0, Math.floor(x / cell)))
    const cy = Math.min(finestGrid - 1, Math.max(0, Math.floor(y / cell)))
    return cy * finestGrid + cx
  }

  let previous: number[] | null = null
  let previousStep: Float32Array | null = null
  const stepWindow: number[] = []
  const turnWindow: number[] = []
  let tick = 0
  let tracedIndex = -1
  const trail: number[] = []

  const pickFromDensestCell = (tracked: number[]): number => {
    const counts = new Map<number, number>()
    for (let i = 0; i < n; i += 1) {
      const key = cellOf(tracked[i * 2]!, tracked[i * 2 + 1]!)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let bestKey = -1
    let bestCount = 0
    for (const [key, count] of counts) {
      if (count > bestCount) {
        bestCount = count
        bestKey = key
      }
    }
    for (let i = 0; i < n; i += 1) {
      if (cellOf(tracked[i * 2]!, tracked[i * 2 + 1]!) === bestKey) return i
    }
    return 0
  }

  const niceUnits = (target: number): number => {
    const pow = 10 ** Math.floor(Math.log10(target))
    for (const mult of [5, 2, 1]) {
      if (mult * pow <= target) return mult * pow
    }
    return pow
  }

  const drawTrail = (): void => {
    const ctx = trailCanvas.getContext('2d')
    if (!ctx || trail.length < 4) return
    const size = 184
    const dpr = window.devicePixelRatio || 1
    if (trailCanvas.width !== size * dpr) {
      trailCanvas.width = size * dpr
      trailCanvas.height = size * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (let i = 0; i < trail.length; i += 2) {
      minX = Math.min(minX, trail[i]!)
      maxX = Math.max(maxX, trail[i]!)
      minY = Math.min(minY, trail[i + 1]!)
      maxY = Math.max(maxY, trail[i + 1]!)
    }
    const span = Math.max(maxX - minX, maxY - minY)
    // Auto-fit, but never zoom past 1 unit per panel — a still point must read
    // as a dot, not be inflated into a false tangle.
    const fitSpan = Math.max(span, 1)
    const scale = (size - 24) / fitSpan
    const midX = (minX + maxX) / 2
    const midY = (minY + maxY) / 2
    const toX = (x: number): number => size / 2 + (x - midX) * scale
    const toY = (y: number): number => size / 2 + (y - midY) * scale

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

    trailLabel.textContent =
      `Trajectory: point ${tracedIndex} (densest cell), last ${trail.length / 2} ticks — path spans ${span.toFixed(2)} u`
  }

  const config: GraphConfig = {
    spaceSize: SPACE,
    fitViewOnInit: true,
    fitViewPadding: 0.3,
    rescalePositions: false,
    randomSeed: SEED,
    pointDefaultSize: 6,
    linkDefaultWidth: 1,
    renderLinks: true,
    // Hold alpha ≈ 1 so the sampled side's shimmer persists instead of
    // annealing away — what a long-running / reheated layout experiences.
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

      if (tracedIndex < 0 && tick >= TRAIL_PICK_TICK) tracedIndex = pickFromDensestCell(tracked)
      if (tracedIndex >= 0) {
        trail.push(tracked[tracedIndex * 2]!, tracked[tracedIndex * 2 + 1]!)
        if (trail.length > TRAIL_WINDOW * 2) trail.splice(0, trail.length - TRAIL_WINDOW * 2)
        drawTrail()
      }

      if (tick % 15 === 0 && stepWindow.length > 0) {
        const meanStep = stepWindow.reduce((a, b) => a + b, 0) / stepWindow.length
        const meanTurn = turnWindow.length > 0 ? turnWindow.reduce((a, b) => a + b, 0) / turnWindow.length : 0
        meter.textContent =
          `last ${stepWindow.length} ticks: step ${meanStep.toFixed(2)} u/tick   turn ${meanTurn.toFixed(1)}°`
      }
    },
  }
  // The per-instance marker read by the patched internals (see the header).
  if (forceSampled) (config as Record<string, unknown>)[FORCE_SAMPLED_KEY] = true

  const graph = new Graph(host, config)

  let destroyed = false
  const setup = async (): Promise<void> => {
    await graph.ready
    if (destroyed) return
    graph.setPointPositions(positions, true)
    graph.setLinks(links)
    graph.render()
    graph.trackPointPositionsByIndices(Array.from({ length: n }, (_, i) => i))
    graph.start(1)
    // Re-fit while the layout finds its equilibrium shape, then leave the
    // camera alone.
    for (const delay of [1500, 3500, 6000]) {
      setTimeout(() => {
        if (!destroyed) graph.fitView(400)
      }, delay)
    }
  }
  // eslint-disable-next-line no-console
  setup().catch((error) => console.error('[country-borders-comparison] failed', error))

  return {
    element: pane,
    graph,
    destroy: (): void => {
      destroyed = true
    },
  }
}

// ── The story: both paths, same data, same tick ─────────────────────────────

export const countryBordersComparison = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  patchForceManyBody()

  const outer = document.createElement('div')
  outer.style.cssText = 'height:100vh;width:100%;background:#1a1d23;color:#e0e0e0;font-family:monospace;display:flex;overflow:hidden;'

  const left = createPane('Today: exact all-pairs repulsion — the current engine', '#7fd1c0', false)
  const right = createPane('Before the fix: sampled near field, K = 8 — forced for comparison', '#e9a13b', true)
  right.element.style.borderLeft = '1px solid #3a3f47'
  outer.appendChild(left.element)
  outer.appendChild(right.element)

  return {
    graph: left.graph,
    div: outer,
    destroy: (): void => {
      // The story contract tears down `graph` (the left pane) itself; the
      // right pane's graph is this story's own cleanup responsibility.
      left.destroy()
      right.destroy()
      right.graph.destroy()
    },
  }
}
