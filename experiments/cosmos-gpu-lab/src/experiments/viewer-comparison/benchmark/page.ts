import { CosmosLabels } from '../../../../../../src/stories/points/labels/labels'
import { motionChecks, percentile } from '../../million-graph/motion-metrics'
import type { Pair } from '../../selection/reference'
import type { Backend, BenchmarkAdapter, ResolvedPick } from './adapter'
import { origin, polygon, prepareFixture, rectangle, viewport, type Workload } from './fixture'
import { observePresentation, type PresentationObserver } from './presentation'

const get = <T extends HTMLElement>(id: string): T => document.querySelector<T>(`#${id}`)!
const nextFrame = async (): Promise<number> => await new Promise(resolve => requestAnimationFrame(resolve))
const host = get<HTMLDivElement>('graph')
const surface = get('surface')
const labelHost = get<HTMLDivElement>('labels')
const pickMarker = get('pick-marker')
const marquee = get('selection')
const feedback = get('feedback')
const stage = get('stage')

type Pick = { id: number | null; requested: number | null; tick: number; ms: number; trusted: boolean }
type Window = { intervals: number[]; p95: number | null; missed: number; coalesced: number; ticks: number[] }
type Readback = {
  shape: string; areaMs: number | null; labelMs: number | null; selected: number | null; labels: number | null;
  areaError: string | null; labelError: string | null; tickBefore: number; tickAfter: number;
}
type Quality = ReturnType<typeof motionChecks> & { tick: number; linkLengthMedian: number; linkLengthP95: number }
type Measurements = {
  backend: Backend; workload: Workload; pointCount: number; linkCount: number; input: string; viewport: typeof viewport; picked: Pick[];
  browser: string; refreshMs: number; stage: string; startupMs: number | null; steady: Window | null; interaction: Window | null;
  readbacks: Readback[]; updates: Record<string, number>; quality: Quality | null; staleAfterReplacement: boolean | null;
}
type Capture = Measurements & {
  hidden: boolean; adapter: BenchmarkAdapter['info'] | null; error: string; peakBytes: number | null;
  submitted?: number; presented?: number; tick?: number; canvas: { width: number; height: number } | null;
}
type BenchmarkRun = {
  open(): Promise<void>;
  motion(warmup: number, intervals: number): Promise<void>;
  beginInteraction(): void;
  prepareClicks(): Promise<void>;
  target(sample: number): Pair;
  waitForFrames(count: number): Promise<void>;
  waitForPick(sample: number): Promise<void>;
  endInteraction(): void;
  readback(samples: number): Promise<void>;
  updates(): Promise<void>;
  snapshot(): Capture;
  close(): void;
}

function measureQuality (initial: Float32Array, positions: Float32Array, links: Float32Array, tick: number): Quality {
  const motion = motionChecks(initial, positions)
  const sample: number[] = []
  const stride = Math.max(1, Math.floor(links.length / 2 / 4096))
  for (let edge = 0; edge < links.length / 2; edge += stride) {
    const a = links[edge * 2] * 4; const b = links[edge * 2 + 1] * 4
    if (positions[a + 3] || positions[b + 3]) continue
    sample.push(Math.hypot(positions[a] - positions[b], positions[a + 1] - positions[b + 1]))
  }
  return { tick, ...motion, linkLengthMedian: percentile(sample, 0.5), linkLengthP95: percentile(sample, 0.95) }
}

async function prepare (backend: Backend, workload: Workload, count: number): Promise<BenchmarkRun> {
  stage.textContent = `${backend.toUpperCase()} · ${workload} · ${count.toLocaleString()} points`
  const fixture = await prepareFixture(workload, count)
  const module = await (backend === 'webgl' ? import('./webgl') : import('./webgpu'))
  if ('productionBundleReady' in module) await module.productionBundleReady
  const initial = fixture.scene.input.points
  const pointCount = initial.length / 4
  const linkCount = fixture.scene.graph.links.length / 2
  const picked: Pick[] = []
  const result: Measurements = {
    backend,
    workload,
    pointCount,
    linkCount,
    input: fixture.digest,
    viewport,
    picked,
    browser: navigator.userAgent,
    refreshMs: 0,
    stage: 'prepared',
    startupMs: null,
    steady: null,
    interaction: null,
    readbacks: [],
    updates: {},
    quality: null,
    staleAfterReplacement: null,
  }
  let graph: BenchmarkAdapter | undefined
  let observer: PresentationObserver | undefined
  let hidden = document.visibilityState !== 'visible'
  let requestId: number | null = null
  let interactionStart = 0
  const clickPositions: Pair[] = []
  const events = new AbortController()
  document.addEventListener('visibilitychange', () => { hidden ||= document.visibilityState !== 'visible' }, { signal: events.signal })
  const health = (): void => {
    if (hidden) throw new Error('Chrome was hidden during this run')
    if (graph?.error) throw new Error(graph.error)
  }
  const ready = (): { graph: BenchmarkAdapter; observer: PresentationObserver } => {
    health()
    if (!graph || !observer) throw new Error('Benchmark graph is unavailable')
    return { graph, observer }
  }
  const tracked = Array.from({ length: Math.min(1000, pointCount) }, (_, i) => Math.floor(i * pointCount / Math.min(1000, pointCount)))
  const labelIds = new Set(tracked)
  const labels = new CosmosLabels(labelHost, new Map(tracked.map(id => [id, `Point ${id}`])))
  const onPick: ResolvedPick = (id, event) => {
    const { graph } = ready()
    const tick = graph.tick
    feedback.textContent = id === null ? 'No point selected' : `Point ${id.toLocaleString()} selected`
    const bounds = graph.canvas.getBoundingClientRect()
    pickMarker.style.left = `${event.clientX - bounds.left}px`
    pickMarker.style.top = `${event.clientY - bounds.top}px`
    pickMarker.hidden = id === null
    const requested = requestId
    nextFrame().then(() => { picked.push({ id, requested, tick, ms: performance.now() - event.timeStamp, trusted: event.isTrusted }) })
  }
  const summarize = (from: number, to: number): Window => {
    const { observer } = ready()
    const samples = observer.frames.slice(from, to)
    const intervals = samples.slice(1).map((frame, i) => frame.time - samples[i].time)
    return {
      intervals,
      p95: intervals.length ? percentile(intervals, 0.95) : null,
      missed: intervals.reduce((total, interval) => total + Math.max(0, Math.round(interval / result.refreshMs) - 1), 0),
      coalesced: samples.length ? samples.at(-1)!.frame - samples[0].frame - intervals.length : 0,
      ticks: samples.map(frame => frame.tick),
    }
  }
  const waitForFrames = async (count: number, timeout = 25000): Promise<void> => {
    const { observer } = ready()
    const start = observer.frames.length
    const deadline = performance.now() + timeout
    while (observer.frames.length < start + count) {
      await observer.after(observer.frames.at(-1)?.frame ?? 0, Math.max(0, deadline - performance.now()))
    }
  }
  const update = async (name: string, change: () => void): Promise<void> => {
    const { observer } = ready()
    const before = observer.submittedCount
    const start = performance.now()
    change()
    await observer.after(before)
    result.updates[name] = performance.now() - start
  }
  const markSelected = (shape: 'rectangle' | 'polygon', count: number): void => {
    const bounds = rectangle
    const corners = shape === 'polygon'
      ? polygon
      : [bounds[0], [bounds[1][0], bounds[0][1]], bounds[1], [bounds[0][0], bounds[1][1]]]
    marquee.style.clipPath = `polygon(${corners.map(([x, y]) => `${x}px ${y}px`).join(', ')})`
    marquee.hidden = false
    feedback.textContent = `${count.toLocaleString()} points selected`
  }

  return {
    async open (): Promise<void> {
      result.stage = 'startup'
      const idle: number[] = []
      let previous = await nextFrame()
      for (let i = 0; i < 20; i++) {
        const now = await nextFrame(); idle.push(now - previous); previous = now
      }
      result.refreshMs = percentile(idle, 0.5)
      health()
      if (navigator.userAgent.includes('HeadlessChrome') || devicePixelRatio !== viewport.pixelRatio) throw new Error('Use visible native Chrome at DPR 2')
      observer = observePresentation(health)
      const started = performance.now()
      graph = await module.createAdapter(host, fixture, observer, onPick)
      if (graph.info.fallback) throw new Error('Unexpected software adapter')
      await observer.after(0)
      result.startupMs = performance.now() - started
      if (graph.canvas.width !== viewport.width * viewport.pixelRatio || graph.canvas.height !== viewport.height * viewport.pixelRatio) {
        throw new Error('The backing canvas size differs from the benchmark')
      }
      const zero = backend === 'webgl' ? origin : 0
      const [x, y] = graph.spaceToScreenPosition([zero + 10, zero])
      if (Math.abs(x - (viewport.width / 2 + 10 * fixture.zoom)) > 0.1 || Math.abs(y - viewport.height / 2) > 0.1) {
        throw new Error(`The first frame used a different camera (${x.toFixed(2)}, ${y.toFixed(2)})`)
      }
      result.stage = 'first frame drawn'
    },
    async motion (warmup: number, intervals: number): Promise<void> {
      const { graph, observer } = ready()
      result.stage = 'steady motion'
      graph.run()
      await waitForFrames(warmup)
      const first = observer.frames.length - 1
      await waitForFrames(intervals, 45000)
      result.steady = summarize(first, first + intervals + 1)
      graph.pause()
      if (result.steady.ticks.at(-1)! <= result.steady.ticks[0]) throw new Error('The graph did not advance during steady motion')
      result.stage = 'motion quality sample'
      result.quality = measureQuality(initial, await graph.positions(), fixture.scene.graph.links, graph.tick)
    },
    beginInteraction (): void {
      const { graph, observer } = ready()
      result.stage = 'native pointer interaction'
      graph.run()
      interactionStart = observer.frames.length
    },
    async prepareClicks (): Promise<void> {
      const { graph } = ready()
      if (workload === 'dense' || workload === 'hubs') {
        const zero = backend === 'webgl' ? origin : 0
        clickPositions.push(graph.spaceToScreenPosition([zero, zero]))
      } else {
        clickPositions.push([110, 106], [740, 130], [810, 400])
        // Place a known target on each graph after the pan/zoom gesture. The
        // other points remain free to move, including during the readbacks.
        fixture.pickIndices.forEach((id, index) => graph.positionUpdate(id, graph.screenToWorld(clickPositions[index]), true))
        await waitForFrames(2)
      }
    },
    target (sample: number): Pair {
      if (sample % 4 === 3) { requestId = null; return [12, 12] }
      requestId = fixture.pickIndices[sample % fixture.pickIndices.length]
      return clickPositions[sample % clickPositions.length]
    },
    waitForFrames,
    async waitForPick (sample: number): Promise<void> {
      const deadline = performance.now() + 20000
      while (picked.length <= sample && performance.now() < deadline) { health(); await nextFrame() }
      if (picked.length !== sample + 1 || !picked[sample]?.trusted) throw new Error('A trusted click did not reach its visible result')
    },
    endInteraction (): void {
      const { observer } = ready()
      result.interaction = summarize(interactionStart, observer.frames.length)
      pickMarker.hidden = true
    },
    async readback (samples: number): Promise<void> {
      const { graph } = ready()
      result.stage = 'moving area selection and labels'
      graph.track(tracked)
      const expectedLabels = tracked.filter(id => !initial[id * 4 + 3]).length
      const firstTick = graph.tick
      for (let i = 0; i < samples; i++) {
        const shape = i % 2 === 0 ? 'rectangle' : 'polygon'
        const tickBefore = graph.tick
        const start = performance.now()
        const [area, label] = await Promise.allSettled([
          graph.select(shape === 'rectangle' ? { rect: rectangle } : { polygon }).then(async ids => {
            if (!ids) throw new Error('The graph returned no area result')
            if (!ids.length) throw new Error('The area resolved with zero selected points')
            markSelected(shape, ids.length)
            await nextFrame()
            return { selected: ids.length, areaMs: performance.now() - start }
          }),
          graph.tracked().then(async positions => {
            if (!positions) throw new Error('The graph returned no tracked positions')
            if (positions.size !== expectedLabels || [...positions.keys()].some(id => !labelIds.has(id))) {
              throw new Error(`Tracked labels returned ${positions.size} points instead of the expected ${expectedLabels} IDs`)
            }
            labels.update(graph, positions)
            await nextFrame()
            return { labels: positions.size, labelMs: performance.now() - start }
          }),
        ])
        // A missing selection must not erase the simultaneous label result or
        // prevent later queries on the same moving graph from running.
        result.readbacks.push({
          shape,
          areaMs: area.status === 'fulfilled' ? area.value.areaMs : null,
          labelMs: label.status === 'fulfilled' ? label.value.labelMs : null,
          selected: area.status === 'fulfilled' ? area.value.selected : null,
          labels: label.status === 'fulfilled' ? label.value.labels : null,
          areaError: area.status === 'rejected' ? String(area.reason) : null,
          labelError: label.status === 'rejected' ? String(label.reason) : null,
          tickBefore,
          tickAfter: graph.tick,
        })
        await waitForFrames(1)
      }
      if (graph.tick <= firstTick) throw new Error('Labels and selection were not measured during simulation')
      labelHost.replaceChildren(); marquee.hidden = true
      graph.track([])
    },
    async updates (): Promise<void> {
      const { graph } = ready()
      result.stage = 'live graph updates'
      const id = fixture.pickIndices[0]
      const point = initial.subarray(id * 4, id * 4 + 2)
      // One visible position patch, then a same-size topology change and full replacement.
      await update('point', () => graph.positionUpdate(id, [point[0] + 3, point[1] - 3]))
      await update('topology', () => graph.topologyUpdate())
      await update('replacement', () => graph.replace())
      result.stage = 'resize and replacement validity'
      await update('resize', () => {
        surface.style.width = '880px'; surface.style.height = '500px'
        graph.resize(880, 500)
      })
      if (graph.canvas.width !== 1760 || graph.canvas.height !== 1000) throw new Error('Resize did not reach the backing canvas')
      const pending = graph.select({ rect: rectangle })
      graph.replace()
      result.staleAfterReplacement = (await pending) === null
      if (!result.staleAfterReplacement) throw new Error('A selection for replaced data was delivered')
      graph.pause()
      result.stage = 'complete'
    },
    snapshot: (): Capture => ({
      ...result,
      hidden,
      adapter: graph?.info ?? null,
      error: graph?.error ?? '',
      peakBytes: graph?.peakBytes ?? null,
      submitted: observer?.submittedCount,
      presented: observer?.frames.length,
      tick: graph?.tick,
      canvas: graph ? { width: graph.canvas.width, height: graph.canvas.height } : null,
    }),
    close (): void { events.abort(); observer?.destroy(); graph?.destroy() },
  }
}

Object.assign(window, {
  async prepareBenchmark (backend: Backend, workload: Workload, count: number): Promise<void> {
    Object.assign(window, { benchmark: await prepare(backend, workload, count) })
  },
})
