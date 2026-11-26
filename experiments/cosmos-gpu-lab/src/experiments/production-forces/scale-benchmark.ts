import { percentile } from '../million-graph/motion-metrics'
import type { Engine } from '../production-graph-api/frame'
import { observePresentation } from '../viewer-comparison/benchmark/presentation'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import { forceConfig, loadForce } from './fixture'
import { scaleFixture, type ScaleCase } from './scale-fixture'
import { layoutCheckpoints } from './scale-layout'
import { measureScaleUpdates, type EditPhases } from './scale-updates'
import { composedChannels, composedConfig, loadComposedChannels } from './scale-composed'

const viewport = { width: 961, height: 541, pixelRatio: 2 }
const nextFrame = async (): Promise<number> => await new Promise(resolve => requestAnimationFrame(resolve))
const host = document.querySelector<HTMLDivElement>('#graph')!
const feedback = document.querySelector<HTMLOutputElement>('#feedback')!

type Pick = {
  sample: number; requested: string; id: string; clickAt: number; callbackAt: number; feedbackAt: number;
  trusted: boolean; inputTick?: number; tick: number; ms: number; xy: [number, number];
}
function distribution (samples: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    p50: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1)!,
  }
}

async function open (
  engine: Engine, kind: ScaleCase, pointCount = 8192, layout = false, composed = false, vendor = 'apple',
  matched = false, bundleUrl?: string
): Promise<void> {
  if (navigator.userAgent.includes('HeadlessChrome') || devicePixelRatio !== viewport.pixelRatio) throw new Error('Requires foreground Chrome at DPR 2')
  const fixture = scaleFixture(kind, pointCount)
  const channels = composed ? composedChannels(fixture) : undefined
  const arrays = {
    positions: fixture.positions,
    links: fixture.links,
    weights: fixture.weights,
    sizes: fixture.sizes,
    colors: fixture.colors,
    linkColors: fixture.linkColors,
    linkWidths: fixture.linkWidths,
    pins: Uint32Array.from(fixture.pinned),
    ...channels,
  }
  const digests = await Promise.all(Object.entries(arrays).map(async ([key, array]) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    const hash = await crypto.subtle.digest('SHA-256', bytes.slice())
    return [key, [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('')]
  }))
  const settings = { ...forceConfig(kind), ...(composed ? composedConfig : {}), enableRenderLoop: !layout && !matched, pixelRatio: viewport.pixelRatio }
  const input = JSON.stringify({ arrays: Object.fromEntries(digests), settings, viewport, matched: matched || undefined })
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
  const pointer = { pressed: false, trusted: false, ticks: [] as number[], target: [] as number[], alpha: 1 }
  let readyBeforeNotification = 0
  let destroyed = false
  let peakBytes = 0
  function sampleMemory (): void { peakBytes = Math.max(peakBytes, memory.count) }
  let current: { sample: number; requested: string; xy: [number, number]; inputTick?: number } | undefined
  window.addEventListener('click', () => { if (current) current.inputTick = tick }, { capture: true })
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
  const GRAPH = await loadGraphPackage(engine, document, bundleUrl)
  const startupStart = performance.now()
  const graph = new GRAPH(host, {
    ...settings,
    onPointClick: (id, _xy, event) => onPick(`Point ${id}`, event),
    onLinkClick: (id, event) => onPick(`Link ${id}`, event),
    onBackgroundClick: event => onPick('Background', event),
    onSimulationTick (alpha): void {
      const submittedTick = ++tick
      if (composed) {
        if (pointer.pressed) pointer.ticks.push(submittedTick)
        pointer.alpha = alpha
      }
      if (layout) return
      // Both packages draw and submit later in this same frame callback. The fence
      // marks its completed GPU work without blocking the autonomous Graph loop.
      queueMicrotask(() => {
        if (destroyed) return
        try {
          const fence = graph.simulation.device!.createFence()
          sampleMemory()
          let done = false
          fence.signaled.then(() => { done = true }, cause => { error = String(cause) }).finally(() => fence.destroy())
          // WebGL may finish before luma's timer has delivered its Promise. Read
          // the public fence state at this observation opportunity on both APIs.
          observer.submitted(submittedTick, () => {
            if (done) return true
            if (!fence.isSignaled()) return false
            readyBeforeNotification++
            return true
          })
        } catch (cause) { error = String(cause) }
      })
    },
  })
  await graph.ready
  const device = graph.simulation.device!
  const memory = device.statsManager.getStats('GPU Time and Memory').get('GPU Memory')
  const adapter = device.info as typeof device.info & { fallback?: boolean }
  const matchesVendor = adapter.gpu === vendor || (adapter.gpu === 'unknown' && adapter.vendor.toLowerCase().includes(vendor))
  if (adapter.type !== engine || adapter.gpuType === 'cpu' || !matchesVendor || (engine === 'webgpu' && adapter.fallback !== false)) {
    throw new Error(`Expected native ${vendor} ${engine}, found ${JSON.stringify(adapter)}`)
  }
  device.lost.then(() => { if (!destroyed) error = 'Graph device lost' })
  if (channels) loadComposedChannels(graph, channels)
  loadForce(graph, kind, viewport, pointCount)
  graph.renderOneFrame()
  sampleMemory()
  const startupFence = device.createFence()
  try { await startupFence.signaled } finally { startupFence.destroy() }
  const startupMs = performance.now() - startupStart
  const canvas = host.querySelector('canvas')!
  if (composed) {
    const [cx, cy] = fixture.communityCenters[0]
    pointer.target = graph.spaceToScreenPosition([cx + 18, cy + 12])
    canvas.addEventListener('pointermove', event => {
      pointer.pressed = (event.buttons & 2) !== 0
      if (pointer.pressed) pointer.trusted = event.isTrusted
    })
    canvas.addEventListener('pointerup', () => { pointer.pressed = false })
  }
  if (canvas.width !== viewport.width * 2 || canvas.height !== viewport.height * 2) throw new Error(`Incorrect backing size ${canvas.width} × ${canvas.height}`)
  const pin = graph.spaceToScreenPosition([fixture.positions[0], fixture.positions[1]])
  if (Math.abs(pin[0] - viewport.width / 2) > 1 || Math.abs(pin[1] - viewport.height / 2) > 1) throw new Error(`Unexpected pin coordinates ${pin}`)
  // Use a fresh blocking WebGL read while paused for qualification. Readback
  // performance has its own experiment and is never part of the frame samples.
  const readPositions = async (): Promise<Float32Array> => engine === 'webgl' && pointCount > 8192
    ? Float32Array.from(graph.getPointPositions())
    : await graph.getPointPositionsAsync()
  const initial = await readPositions()
  const pins = new Set(fixture.pinned)
  async function quality (): Promise<{ freeMoved: number; nonfinite: number; fixedMoved: number; flagErrors: number; endpointErrors: number }> {
    const xy = await readPositions()
    if (xy.length !== fixture.positions.length || initial.length !== xy.length) throw new Error('Graph point count changed')
    let freeMoved = 0; let fixedMoved = 0; let nonfinite = 0; let flagErrors = 0
    for (let i = 0; i < xy.length; i += 2) {
      const pinned = pins.has(i / 2)
      // 3.6.1 looks up each pin by scanning the pin array. Check coordinates
      // for every pin and query membership for a bounded set on large graphs.
      if ((pointCount <= 8192 || i === 0 || i === 2 || (i / 2) % 257 === 0) && pinned !== graph.isPointPinned(i / 2)) flagErrors++
      if (Number.isNaN(fixture.positions[i])) {
        if (!Number.isNaN(xy[i]) || !Number.isNaN(xy[i + 1])) flagErrors++
      } else {
        if (!Number.isFinite(xy[i]) || !Number.isFinite(xy[i + 1])) nonfinite++
        const moved = xy[i] !== initial[i] || xy[i + 1] !== initial[i + 1]
        if (pinned && moved) fixedMoved++
        if (!pinned && moved) freeMoved++
      }
    }
    let endpointErrors = 0
    for (let id = 0; id < fixture.metadata.linkCount; id++) {
      const endpoints = graph.getConnectedPointIndices(id)
      if (endpoints.length !== 2 || endpoints[0] !== fixture.links[2 * id] || endpoints[1] !== fixture.links[2 * id + 1]) endpointErrors++
    }
    if (endpointErrors) throw new Error(`${endpointErrors} ordered links changed`)
    return { nonfinite, flagErrors, fixedMoved, freeMoved, endpointErrors }
  }
  async function frames (count: number): Promise<void> {
    const target = observer.frames.length + count
    const deadline = performance.now() + 45000
    while (observer.frames.length < target) {
      const last = observer.frames.at(-1)?.frame ?? 0
      if (matched) graph.renderOneFrame()
      const completed = await observer.after(last, deadline - performance.now())
      if (matched && (completed.frame !== last + 1 || completed.tick !== tick)) throw new Error('A host frame skipped or coalesced a simulation tick')
    }
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
    pointer: composed ? pointer : undefined,
    get submittedTicks (): number { return tick },
    startupMs,
    updates: {} as Partial<Awaited<ReturnType<typeof measureScaleUpdates>>>,
    editTick: undefined as number | undefined,
    editPhases: matched ? {} as Partial<Record<keyof Awaited<ReturnType<typeof measureScaleUpdates>>, EditPhases>> : undefined,
    memoryAfterTeardown: undefined as number | undefined,
    get peakBytes (): number { return peakBytes },
    get readyBeforeNotification (): number { return readyBeforeNotification },
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
      checkpoint: layout ? layoutCheckpoints(graph, fixture, readPositions, composed) : undefined,
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
        result.editTick = tick
        if (matched) graph.setConfig({ enableRenderLoop: true })
        result.quality = await quality()
        if (!layout && pointCount > 8192) result.updates = await measureScaleUpdates(graph, host, fixture, readPositions, sampleMemory, result.editPhases)
        sampleMemory()
        destroyed = true
        observer.destroy()
        graph.destroy()
        result.memoryAfterTeardown = memory.count
      },
    },
  })
}

Object.assign(window, { openForceTiming: open })
