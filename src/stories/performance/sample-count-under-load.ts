import { Graph } from '@cosmos.gl/graph'
import { generateHyperbolicGraph } from '../utils'

// What the near-field sample count costs on a realistic graph. A hyperbolic
// random graph (the generator of the Hyperbolic Graph story) of 25k, 50k or 100k
// points, with about seven links a point, and alpha held at 1 so the simulation
// runs, and measures, for as long as the story is open.
//
// The samples switch sets `simulationRepulsionSamples`: a number fixes how many
// points of each finest grid cell a point is repelled by, one render pass over
// every point per tick each. A point in a cell fuller than that is sampled anew
// every tick, and its force jitters. Most of this graph holds a few points a
// cell, but at 50k its core packs 9 to 17: zoom into it, and its points jitter
// at 8 and stand still at 16. Counts above what the cells hold
// change nothing but the cost, which shows in steps a second once the graph is
// large. `auto` leaves the key unset, and the engine measures how full the cells
// are and picks the smallest count that leaves at most 1 % of the points in
// fuller cells: 8 at 25k, 16 at 50k and 100k.
//
// Each `auto` measurement reads back from the GPU, and the render loop holds its
// next frame until the GPU has drawn everything queued ahead of the copy. Where
// the GPU keeps up that is nothing; where it runs a few frames behind, the step
// of the held frame shows as one long red bar in the panel's strip. The
// measurements come every 30 steps, and each waits a hundred times the last one's
// hold, so the holds take about 1 % of the time: at 50k the red bars come some
// 15 s apart, at 100k some 25 s (the hold counts from the first frame held back,
// so it is shorter than the bar). A fixed count measures nothing. Picking a number
// and then `auto` again starts the measurement over from the size tier.
//
// The panel times simulation steps, from `onSimulationTick`, over the last five
// seconds: one step a frame while the simulation runs, so a held frame is a long
// step. The simulation does not step during a zoom (`enableSimulationDuringZoom` is
// off), so no interval is measured across one: a zoom is not a held frame.

const SPACE = 4096
const SIZE_OPTIONS: readonly number[] = [25_000, 50_000, 100_000]
const SAMPLE_OPTIONS = ['auto', 8, 16, 32, 64] as const
const WINDOW_MS = 5000
const STRIP_STEPS = 300
const MAX_POINT_SIZE = 5

const TEXT = '#e0e0e0'
const MUTED = '#9aa3ad'
const LINE = '#2e333b'
const BAR = '#4a90d9'
const LONG_BAR = '#e0675a'

type Switch<T> = { element: HTMLDivElement; setActive: (option: T) => void }

/** A label and a row of buttons, one active at a time. */
const createSwitch = <T>(label: string, options: readonly T[], format: (option: T) => string, onPick: (option: T) => void): Switch<T> => {
  const element = document.createElement('div')
  element.style.cssText = 'display:flex;gap:8px;align-items:center;'
  element.append(document.createTextNode(label))
  const segments = document.createElement('div')
  segments.style.cssText = `display:inline-flex;border:1px solid ${LINE};border-radius:6px;overflow:hidden;`
  const buttons = options.map((option) => {
    const button = document.createElement('button')
    button.textContent = format(option)
    button.style.cssText = 'font:inherit;padding:3px 10px;background:transparent;border:0;cursor:pointer;'
    button.addEventListener('click', () => onPick(option))
    segments.appendChild(button)
    return { option, button }
  })
  element.appendChild(segments)
  const setActive = (active: T): void => {
    for (const { option, button } of buttons) {
      button.style.background = option === active ? LINE : 'transparent'
      button.style.color = option === active ? TEXT : MUTED
      button.setAttribute('aria-pressed', String(option === active))
    }
  }
  return { element, setActive }
}

type ManyBodyInternals = { nearField?: { count: number }; autoSlotCount?: number }

export const sampleCountUnderLoad = (): { graph: Graph; div: HTMLDivElement; destroy?: () => void } => {
  const outer = document.createElement('div')
  outer.style.cssText = `height:100vh;width:100%;background:#2d313a;color:${TEXT};font-family:monospace;display:flex;flex-direction:column;overflow:hidden;`

  const bar = document.createElement('div')
  bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;padding:6px 12px;font-size:12px;flex:none;background:#1a1d23;' +
    `border-bottom:1px solid ${LINE};color:${MUTED};`
  outer.appendChild(bar)

  const body = document.createElement('div')
  body.style.cssText = 'position:relative;flex:1;min-height:0;'
  outer.appendChild(body)
  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;inset:0;'
  body.appendChild(host)

  const panel = document.createElement('div')
  panel.style.cssText = 'position:absolute;left:12px;top:12px;padding:10px 12px;background:rgba(26,29,35,0.88);' +
    `border:1px solid ${LINE};border-radius:6px;font-size:12px;line-height:1.6;color:${MUTED};pointer-events:none;`
  const stats = document.createElement('pre')
  stats.style.cssText = 'margin:0;font:inherit;'
  const strip = document.createElement('canvas')
  strip.style.cssText = 'display:block;width:300px;height:64px;margin-top:8px;'
  strip.width = 600
  strip.height = 128
  const stripLabel = document.createElement('div')
  stripLabel.style.cssText = 'font-size:10px;'
  stripLabel.textContent = `last ${STRIP_STEPS} steps · one bar per step · red ≥ 2× median`
  panel.append(stats, strip, stripLabel)
  body.appendChild(panel)

  // Step times as intervals between consecutive ticks, each with the time it ended
  const intervals: { at: number; ms: number }[] = []
  let lastTick: number | undefined
  // The strip's step times, newest last: the last STRIP_STEPS steps, however long they took
  const stripSteps: number[] = []
  const resetSteps = (): void => {
    intervals.length = 0
    stripSteps.length = 0
    lastTick = undefined
  }
  const graph = new Graph(host, {
    spaceSize: SPACE,
    backgroundColor: '#2d313a',
    pointDefaultSize: 1.5,
    scalePointsOnZoom: false,
    linkDefaultColor: '#5F74C2',
    linkDefaultWidth: 0.5,
    linkGreyoutOpacity: 0,
    // Faint, and fainter the longer they are on screen: the points stay readable under the links
    linkOpacity: 0.3,
    linkVisibilityMinTransparency: 0.05,
    enableDrag: false,
    fitViewOnInit: false,
    simulationFriction: 0.85,
    simulationLinkSpring: 1,
    simulationLinkDistance: 10,
    simulationRepulsion: 0.5,
    simulationGravity: 0.25,
    // Alpha stays at 1: the simulation runs, and measures, for as long as the story is open
    simulationDecay: 1e9,
    onSimulationTick: (): void => {
      const now = performance.now()
      if (lastTick !== undefined) {
        intervals.push({ at: now, ms: now - lastTick })
        stripSteps.push(now - lastTick)
        if (stripSteps.length > STRIP_STEPS) stripSteps.shift()
      }
      lastTick = now
    },
    // The next interval starts after the zoom, with the first tick that follows it
    onZoomStart: (): void => { lastTick = undefined },
  })

  let size = SIZE_OPTIONS[1]!
  let samples: number | undefined
  let fitTimer = 0

  const loadGraph = (pointCount: number): void => {
    size = pointCount
    const { pointPositions, pointColors, pointSizes, links } = generateHyperbolicGraph({
      nodeCount: pointCount,
      avgDegree: 14,
      alpha: 0.75,
      spaceSize: SPACE,
      seed: 42,
    })
    graph.setPointPositions(pointPositions)
    graph.setPointColors(pointColors)
    // The generator grows a point with its degree; capped, so a hub of thousands of links
    // does not cover the core at a fixed screen size
    graph.setPointSizes(pointSizes.map(pointSize => Math.min(pointSize, MAX_POINT_SIZE)))
    graph.setLinks(links)
    // Snap, with no position transition: a transition pauses the simulation
    graph.render(1, 0)
    resetSteps()
    window.clearTimeout(fitTimer)
    fitTimer = window.setTimeout(() => graph.fitView(500), 2000)
  }

  const sizeSwitch = createSwitch('points', SIZE_OPTIONS, (count) => `${count / 1000}k`, (count) => {
    loadGraph(count)
    sizeSwitch.setActive(count)
  })
  const samplesSwitch = createSwitch('samples', SAMPLE_OPTIONS, String, (option) => {
    samples = option === 'auto' ? undefined : option
    graph.setConfigPartial({ simulationRepulsionSamples: samples })
    resetSteps()
    samplesSwitch.setActive(option)
  })
  sizeSwitch.setActive(size)
  samplesSwitch.setActive('auto')
  bar.append(sizeSwitch.element, samplesSwitch.element)

  // The count the force runs, and what the measurement wants, are internal; read here for display only
  const manyBody = (): ManyBodyInternals | undefined =>
    (graph as unknown as { simulation?: { forceManyBody?: ManyBodyInternals } }).simulation?.forceManyBody

  const context = strip.getContext('2d')
  const paint = (): void => {
    const now = performance.now()
    while (intervals.length > 0 && intervals[0]!.at < now - WINDOW_MS) intervals.shift()
    const steps = intervals.map(interval => interval.ms)
    const sorted = [...steps].sort((a, b) => a - b)
    const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
    const median = at(0.5)
    const isLong = (ms: number): boolean => median > 0 && ms >= 2 * median
    const ms = (value: number): string => `${value.toFixed(1)} ms`.padStart(9)
    const force = manyBody()
    const wanted = force?.autoSlotCount
    const source = samples !== undefined ? 'fixed' : wanted === undefined ? 'auto, before a reading' : `auto, wanted ${wanted}`
    // Over the time the measured steps took: the window starts empty after a switch and fills
    // over 5 s, and a zoom between two steps is not part of it
    const measured = steps.reduce((sum, step) => sum + step, 0)
    const stepsPerSecond = measured > 0 ? steps.length / (measured / 1000) : 0
    stats.textContent = [
      `samples in force ${String(force?.nearField?.count ?? '—').padStart(6)}  (${source})`,
      `step median      ${ms(median)}`,
      `step p99         ${ms(at(0.99))}`,
      `step max         ${ms(sorted[sorted.length - 1] ?? 0)}`,
      `long steps       ${String(steps.filter(isLong).length).padStart(6)}   in ${(measured / 1000).toFixed(1)} s`,
      `steps per second ${String(Math.round(stepsPerSecond)).padStart(6)}`,
    ].join('\n')

    if (!context) return
    const { width, height } = strip
    context.clearRect(0, 0, width, height)
    // One bar a step at a fixed width, the newest on the right, filling leftwards as steps come.
    // A typical step stands at half the height; a step slower than twice that sets the height
    // instead, so a long one stands at its true proportion
    const typical = [...stripSteps].sort((a, b) => a - b)[Math.floor(stripSteps.length / 2)] ?? 0
    const top = Math.max(2 * typical, ...stripSteps)
    const scale = top > 0 ? height / top : 0
    const barWidth = width / STRIP_STEPS
    const offset = STRIP_STEPS - stripSteps.length
    for (const [i, step] of stripSteps.entries()) {
      context.fillStyle = isLong(step) ? LONG_BAR : BAR
      const barHeight = step * scale
      context.fillRect((offset + i) * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight)
    }
  }
  const timer = window.setInterval(paint, 250)
  // A hidden tab runs no frames: the first tick back would measure the whole time away
  const onVisibilityChange = (): void => { lastTick = undefined }
  document.addEventListener('visibilitychange', onVisibilityChange)

  loadGraph(size)

  return {
    graph,
    div: outer,
    destroy: (): void => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearTimeout(fitTimer)
    },
  }
}
