import { percentile } from '../million-graph/motion-metrics'
import type { Engine } from '../production-graph-api/frame'
import { observePresentation } from '../viewer-comparison/benchmark/presentation'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import { forceConfig, loadForce } from './fixture'
import { scaleFixture, type ScaleCase } from './scale-fixture'

const viewport = { width: 961, height: 541, pixelRatio: 2 }
const nextFrame = async (): Promise<number> => await new Promise(resolve => requestAnimationFrame(resolve))
const host = document.querySelector<HTMLDivElement>('#graph')!
const feedback = document.querySelector<HTMLOutputElement>('#feedback')!

type Pick = {
  sample: number; requested: string; id: string; clickAt: number; callbackAt: number; feedbackAt: number;
  trusted: boolean; tick: number; ms: number; xy: [number, number];
}
function distribution (samples: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    p50: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1)!,
  }
}

async function open (engine: Engine, kind: ScaleCase): Promise<void> {
  if (navigator.userAgent.includes('HeadlessChrome') || devicePixelRatio !== viewport.pixelRatio) throw new Error('Requires foreground Chrome at DPR 2')
  const fixture = scaleFixture(kind)
  const arrays = {
    positions: fixture.positions,
    links: fixture.links,
    weights: fixture.weights,
    sizes: fixture.sizes,
    colors: fixture.colors,
    linkColors: fixture.linkColors,
    linkWidths: fixture.linkWidths,
    pins: Uint32Array.from(fixture.pinned),
  }
  const digests = await Promise.all(Object.entries(arrays).map(async ([key, array]) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    const hash = await crypto.subtle.digest('SHA-256', bytes.slice())
    return [key, [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('')]
  }))
  const settings = { ...forceConfig(kind), enableRenderLoop: true, pixelRatio: viewport.pixelRatio }
  const input = JSON.stringify({ arrays: Object.fromEntries(digests), settings, viewport })
  let hidden = document.visibilityState !== 'visible'
  document.addEventListener('visibilitychange', () => { hidden ||= document.visibilityState !== 'visible' })
  let error = ''
  const health = (): void => {
    if (hidden) throw new Error('Browser hidden during timing')
    if (error) throw new Error(error)
  }
  const idle: number[] = []
  let last = await nextFrame()
  for (let i = 0; i < 20; i++) { const now = await nextFrame(); idle.push(now - last); last = now }
  const refreshMs = percentile(idle, 0.5)
  const observer = observePresentation(health)
  let tick = 0
  let destroyed = false
  let current: { sample: number; requested: string; xy: [number, number] } | undefined
  const picked: Pick[] = []
  function onPick (id: string, event: MouseEvent): void {
    const callbackAt = performance.now()
    const request = current
    if (!request) return
    current = undefined
    if (!graph.isSimulationRunning) error = 'Simulation stopped before click feedback'
    const callbackTick = tick
    feedback.value = `${request.sample + 1}. ${id}`
    requestAnimationFrame(() => {
      const feedbackAt = performance.now()
      picked.push({
        ...request,
        id,
        callbackAt,
        feedbackAt,
        clickAt: event.timeStamp,
        tick: callbackTick,
        trusted: event.isTrusted,
        ms: feedbackAt - event.timeStamp,
      })
    })
  }
  const GRAPH = await loadGraphPackage(engine)
  const graph = new GRAPH(host, {
    ...settings,
    onPointClick: (id, _xy, event) => onPick(`Point ${id}`, event),
    onLinkClick: (id, event) => onPick(`Link ${id}`, event),
    onBackgroundClick: event => onPick('Background', event),
    onSimulationTick (): void {
      const submittedTick = ++tick
      // Both packages draw and submit later in this same frame callback. The fence
      // marks its completed GPU work without blocking the autonomous Graph loop.
      queueMicrotask(() => {
        if (destroyed) return
        try {
          const fence = graph.simulation.device!.createFence()
          let done = false
          fence.signaled.then(() => { done = true }, cause => { error = String(cause) }).finally(() => fence.destroy())
          observer.submitted(submittedTick, () => done)
        } catch (cause) { error = String(cause) }
      })
    },
  })
  await graph.ready
  const device = graph.simulation.device!
  const adapter = device.info as typeof device.info & { fallback?: boolean }
  if (adapter.type !== engine || adapter.gpuType === 'cpu' || !/apple/i.test(JSON.stringify(adapter)) ||
    (engine === 'webgpu' && adapter.fallback !== false)) throw new Error(`Unexpected device ${JSON.stringify(adapter)}`)
  device.lost.then(() => { if (!destroyed) error = 'Graph device lost' })
  loadForce(graph, kind, viewport)
  graph.renderOneFrame()
  const canvas = host.querySelector('canvas')!
  if (canvas.width !== viewport.width * 2 || canvas.height !== viewport.height * 2) throw new Error(`Incorrect backing size ${canvas.width} × ${canvas.height}`)
  const pin = graph.spaceToScreenPosition([fixture.positions[0], fixture.positions[1]])
  if (Math.abs(pin[0] - viewport.width / 2) > 1 || Math.abs(pin[1] - viewport.height / 2) > 1) throw new Error(`Unexpected pin coordinates ${pin}`)
  const initial = await graph.getPointPositionsAsync()
  const pins = new Set(fixture.pinned)
  async function quality (): Promise<{ freeMoved: number; nonfinite: number; fixedMoved: number; flagErrors: number }> {
    const xy = await graph.getPointPositionsAsync()
    if (xy.length !== fixture.positions.length || initial.length !== xy.length) throw new Error('Graph point count changed')
    let freeMoved = 0; let fixedMoved = 0; let nonfinite = 0; let flagErrors = 0
    for (let i = 0; i < xy.length; i += 2) {
      const pinned = pins.has(i / 2)
      if (pinned !== graph.isPointPinned(i / 2)) flagErrors++
      if (Number.isNaN(fixture.positions[i])) {
        if (!Number.isNaN(xy[i]) || !Number.isNaN(xy[i + 1])) flagErrors++
      } else {
        if (!Number.isFinite(xy[i]) || !Number.isFinite(xy[i + 1])) nonfinite++
        const moved = xy[i] !== initial[i] || xy[i + 1] !== initial[i + 1]
        if (pinned && moved) fixedMoved++
        if (!pinned && moved) freeMoved++
      }
    }
    return { nonfinite, flagErrors, fixedMoved, freeMoved }
  }
  async function frames (count: number): Promise<void> {
    const target = observer.frames.length + count
    const deadline = performance.now() + 45000
    while (observer.frames.length < target) await observer.after(observer.frames.at(-1)?.frame ?? 0, deadline - performance.now())
    health()
  }
  const result = {
    engine,
    kind,
    input,
    settings,
    viewport,
    metadata: fixture.metadata,
    adapter,
    browser: navigator.userAgent,
    idle,
    refreshMs,
    picked,
    steady: undefined as undefined | ReturnType<typeof windowStats>,
    quality: undefined as undefined | Awaited<ReturnType<typeof quality>>,
  }
  function windowStats (first: number, count: number): {
    intervals: number[]; ticks: number[]; missed: number; coalesced: number; p50: number; p95: number; max: number;
  } {
    const samples = observer.frames.slice(first, first + count + 1)
    const intervals = samples.slice(1).map((frame, i) => frame.time - samples[i].time)
    const ticks = samples.map(f => f.tick)
    if (samples.length !== count + 1 || ticks.some((t, i) => i > 0 && t <= ticks[i - 1])) throw new Error('Steady window lost moving samples')
    const coalesced = samples.at(-1)!.frame - samples[0].frame - count
    const missed = intervals.reduce((sum, v) => sum + Math.max(0, Math.round(v / refreshMs) - 1), 0)
    return { intervals, ticks, missed, coalesced, ...distribution(intervals) }
  }
  Object.assign(window, {
    forceTiming: {
      async run (warmup: number, count: number): Promise<void> {
        graph.unpause()
        await frames(warmup)
        const first = observer.frames.length - 1
        await frames(count)
        result.steady = windowStats(first, count)
      },
      target (sample: number): [number, number] {
        if (sample !== picked.length || current || !graph.isSimulationRunning) throw new Error('Unexpected click state')
        const background = sample % 2 === 1
        const xy: [number, number] = background ? [12, 12] : pin
        current = { sample, xy, requested: background ? 'Background' : 'Point 0' }
        return xy
      },
      frames,
      snapshot: () => result,
      async finish (): Promise<void> {
        health()
        graph.pause()
        result.quality = await quality()
        destroyed = true
        observer.destroy()
        graph.destroy()
      },
    },
  })
}

Object.assign(window, { openForceTiming: open })
