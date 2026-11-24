import { CosmosLabels } from '../../../../../src/stories/points/labels/labels'
import { loadYoutubeFixture } from '../million-graph/youtube-fixture'
import { applyComparisonInput, origin, prepareComparisonInput, seed } from '../viewer-comparison/comparison-input'
import { loadGraphPackage } from '../viewer-comparison/production-bundle'
import { viewport } from '../viewer-comparison/benchmark/fixture'
import type { Pair } from '../selection/reference'
import { arrayHash, type ReleaseOracle, verifyRelease } from './youtube-oracle'
import { YoutubeQueueProfile, type IsolatedCosts, type FrozenDraw } from './youtube-queue-profile'

const now = (): number => performance.now()
const nextFrame = (): Promise<void> => new Promise(resolve => requestAnimationFrame(() => resolve()))
type ReplayMode = 'correctness' | 'timing' | 'drained' | 'blocking' | 'profile'
type TimedRead<T> = { value: T | null; submitMs: number; elapsedMs: number; readyMs: number; error: string | null }
type ReplaySample = {
  index: number;
  from: Pair;
  to: Pair;
  rect: [Pair, Pair];
  center: Pair;
  zoom: number;
  selected: number | null;
  labels: number | null;
  visibleLabelElements: number | null;
  ordered: boolean | null;
  verified: boolean;
  missing: number | null;
  extra: number | null;
  wrongLabels: number | null;
  oracle: ReleaseOracle | null;
  errors: string[];
  trusted: boolean;
  visible: boolean;
  tickAtRelease: number;
  tickAfterFeedback: number;
  timings: Record<string, number | null>;
  profile?: Record<string, number | null>;
}
type ReplaySession = {
  info: object;
  links: number;
  input: Record<string, string>;
  readonly tick: number;
  result: (expectedIndex: number) => Promise<ReplaySample>;
  isolatedCosts: () => Promise<IsolatedCosts>;
  frozenDraw: (tick: number) => Promise<FrozenDraw>;
  destroy: () => void;
}

/** Invoke immediately, then timestamp either outcome before the caller resumes to update the UI. */
function readAtRelease<T> (name: string, request: () => Promise<T | null>, release: number): Promise<TimedRead<T>> {
  const start = now()
  let submitMs = 0
  const finish = (value: T | null, error: string | null): TimedRead<T> => {
    const end = now()
    return { value, submitMs, elapsedMs: end - start, readyMs: end - release, error }
  }
  try {
    const response = request()
    submitMs = now() - start
    return response.then(value => finish(value, value === null ? `${name} returned null` : null), err => finish(null, `${name}: ${String(err)}`))
  } catch (error) {
    submitMs = now() - start
    return Promise.resolve(finish(null, `${name}: ${String(error)}`))
  }
}

function readBlocking<T> (name: string, request: () => T, release: number): TimedRead<T> {
  const start = now()
  let value: T | null = null
  let error: string | null = null
  try { value = request() } catch (reason) { error = `${name}: ${String(reason)}` }
  const end = now()
  return { value, submitMs: end - start, elapsedMs: end - start, readyMs: end - release, error }
}

// The native driver opens one real package per page, with the same public Graph calls.
export async function openYoutubeCheck (count: number, engine: 'webgl' | 'webgpu', mode: ReplayMode): Promise<ReplaySession> {
  if ((mode === 'drained' || mode === 'blocking') && engine !== 'webgl') throw new Error('The synchronous release diagnostic requires WebGL')
  if (mode === 'profile' && engine !== 'webgpu') throw new Error('The queue profile requires WebGPU')
  const graphHost = document.querySelector<HTMLDivElement>('#graph')!
  const surface = document.querySelector<HTMLDivElement>('#surface')!
  const labelHost = document.querySelector<HTMLDivElement>('#labels')!
  const feedback = document.querySelector<HTMLOutputElement>('#feedback')!
  const box = document.querySelector<HTMLDivElement>('#selection')!
  const scene = await loadYoutubeFixture(count)
  const input = prepareComparisonInput(scene, 2)
  const tracked = Array.from({ length: 1000 }, (_, i) => Math.floor(i * count / 1000))
  const hashes = {
    positions: await arrayHash(input.positions),
    links: await arrayHash(scene.graph.links),
    weights: await arrayHash(scene.graph.weights),
    pins: await arrayHash(Uint32Array.from(input.pinned)),
    tracked: await arrayHash(Uint32Array.from(tracked)),
  }
  const GRAPH = await loadGraphPackage(engine)
  let tick = 0
  let profile: YoutubeQueueProfile | undefined
  let afterDraw: (() => void) | undefined
  const graph = new GRAPH(graphHost, {
    fitViewOnInit: false,
    rescalePositions: false,
    enableZoom: false,
    initialZoomLevel: 0.25,
    pixelRatio: viewport.pixelRatio,
    randomSeed: seed,
    pointDefaultSize: 2,
    onSimulationTick (): void {
      tick++
      profile?.afterStep(tick)
      if (afterDraw) {
        // The graph completes this autonomous frame's draw/submit in the same task.
        queueMicrotask(afterDraw)
        afterDraw = undefined
      }
    },
  })
  try {
    await graph.ready
    const device = graph.simulation.device!
    if (mode === 'profile') profile = new YoutubeQueueProfile(graph, () => tick)
    applyComparisonInput(graph, input)
    graph.render(1, 0)
    graph.setZoomTransformByPointPositions(Float32Array.of(origin, origin), 0, 0.25, 0)
    graph.unpause()
    const labels = new CosmosLabels(labelHost, new Map(tracked.map(id => [id, String(id)])))
    graph.trackPointPositionsByIndices(tracked)
    const selectionLayer = document.createElement('div')
    selectionLayer.style.cssText = 'position:absolute;inset:0;touch-action:none;cursor:crosshair'
    surface.append(selectionLayer)
    let start: Pair | undefined
    let pending: ReturnType<typeof replay> | undefined
    let index = -1
    let hidden = document.hidden
    const visibility = (): void => { hidden ||= document.hidden }
    document.addEventListener('visibilitychange', visibility)
    const local = (event: PointerEvent): Pair => {
      const bounds = surface.getBoundingClientRect()
      return [event.clientX - bounds.left, event.clientY - bounds.top]
    }

    /** Queue a marker after the first normal draw containing the changed highlights. */
    function observeHighlight (): Promise<{ submitted: number; observed: number } | null> {
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => { afterDraw = undefined; resolve(null) }, 30000)
        afterDraw = (): void => {
          try {
            const submitted = now()
            const fence = device.createFence()
            let done = false
            const observe = (): void => {
              try {
                if (done || fence.isSignaled()) {
                  clearTimeout(timer)
                  resolve({ submitted, observed: now() })
                } else if (now() - submitted < 30000) requestAnimationFrame(observe)
              } catch (error) { clearTimeout(timer); reject(error) }
            }
            fence.signaled.then(() => { done = true }, error => { clearTimeout(timer); reject(error) }).finally(() => fence.destroy())
            requestAnimationFrame(observe)
          } catch (error) { clearTimeout(timer); reject(error) }
        }
      })
    }

    async function replay (event: PointerEvent, from: Pair, to: Pair, sampleIndex: number): Promise<ReplaySample> {
      const release = now()
      const rect: [Pair, Pair] = [[Math.min(from[0], to[0]), Math.min(from[1], to[1])], [Math.max(from[0], to[0]), Math.max(from[1], to[1])]]
      const tickAtRelease = tick
      const zoom = graph.getZoomLevel()
      const center = graph.spaceToScreenPosition([origin, origin])
      const errors: string[] = []
      let drainedSnapshot: Float32Array | undefined
      let drainMs: number | null = null
      if (mode === 'drained') {
        // Diagnostic only: stall until all preceding WebGL work and the full position copy finish.
        const drainStart = now()
        try {
          drainedSnapshot = graph.getPointPositionsArray()
        } catch (error) {
          errors.push(`Synchronous release snapshot: ${String(error)}`)
        } finally {
          drainMs = now() - drainStart
        }
      }
      const blocking = mode === 'blocking'
      const beforeQueries = profile?.mark()
      const ids = blocking
        ? readBlocking('selection', () => graph.findPointsInRect(rect), release)
        : readAtRelease('selection', () => graph.findPointsInRectAsync(rect), release)
      const labelRead = blocking
        ? readBlocking('tracked labels', () => graph.getTrackedPointPositionsMap(), release)
        : readAtRelease('tracked labels', () => graph.getTrackedPointPositionsMapAsync(), release)
      let snapshot: TimedRead<Float32Array> | Promise<TimedRead<Float32Array>> | null = null
      if (blocking) snapshot = readBlocking('release snapshot', () => graph.getPointPositionsArray(), release)
      if (mode === 'correctness') snapshot = readAtRelease('release snapshot', () => graph.getPointPositionsAsync(), release)
      // Measure both independently submitted reads before any highlight upload or label DOM work.
      const [selection, labelsResult] = await Promise.all([ids, labelRead])
      if (selection.error) errors.push(selection.error)
      if (labelsResult.error) errors.push(labelsResult.error)
      const selected = selection.value
      let highlightUpdateMs: number | null = null
      let highlightFrame: ReturnType<typeof observeHighlight> | undefined
      const beforeHighlight = profile?.mark()
      const highlightStart = now()
      if (selected) {
        graph.setConfigPartial({ highlightedPointIndices: selected })
        highlightUpdateMs = now() - highlightStart
        highlightFrame = observeHighlight().catch(error => { errors.push(String(error)); return null })
      }
      const afterHighlight = profile?.mark()
      feedback.textContent = selected ? `${selected.length} selected` : 'Selection unavailable'
      Object.assign(box.style, {
        left: `${rect[0][0]}px`,
        top: `${rect[0][1]}px`,
        width: `${rect[1][0] - rect[0][0]}px`,
        height: `${rect[1][1] - rect[0][1]}px`,
      })
      box.hidden = false
      const positions = labelsResult.value
      let labelRedrawMs: number | null = null
      if (positions) {
        const drawStart = now()
        labels.update(graph, positions)
        labelRedrawMs = now() - drawStart
      }
      await nextFrame()
      await nextFrame()
      const presentationMs = now() - release
      const frame = await highlightFrame
      if (highlightFrame && !frame) errors.push('Highlighted frame was not observed within 30 seconds')
      const tickAfterFeedback = tick
      const oracleRead = await snapshot
      if (oracleRead?.error) errors.push(oracleRead.error)
      let oracle: ReleaseOracle | null = null
      const releaseXY = oracleRead?.value ?? drainedSnapshot
      if (releaseXY) {
        try {
          oracle = await verifyRelease(releaseXY, count, origin, center, zoom, rect, selected, tracked, positions)
        } catch (error) {
          errors.push(`Release oracle: ${String(error)}`)
        }
      }
      const ordered = selected?.every((id, i) => !i || selected[i - 1] < id) ?? null
      let queueProfile: ReplaySample['profile']
      if (beforeQueries && beforeHighlight && afterHighlight) {
        queueProfile = {
          unacknowledgedFramesAtRelease: beforeQueries.pendingFrames,
          unacknowledgedFramesBeforeHighlight: beforeHighlight.pendingFrames,
          queueAheadAtReleaseMs: await beforeQueries.completedAt - release,
          queueAheadBeforeHighlightMs: await beforeHighlight.completedAt - beforeHighlight.submittedAt,
          throughHighlightWritesMs: await afterHighlight.completedAt - beforeHighlight.submittedAt,
          highlightedFrameAfterWritesMs: frame ? frame.observed - await afterHighlight.completedAt : null,
        }
      }
      return {
        index: sampleIndex,
        from,
        to,
        rect,
        center,
        zoom,
        selected: selected?.length ?? null,
        labels: positions?.size ?? null,
        visibleLabelElements: mode !== 'timing' && positions ? labelHost.childElementCount : null,
        ordered,
        verified: ordered === true && oracle?.missing === 0 && oracle.extra === 0 &&
          positions?.size === tracked.length && oracle.wrongLabels === 0,
        missing: oracle?.missing ?? null,
        extra: oracle?.extra ?? null,
        wrongLabels: oracle?.wrongLabels ?? null,
        oracle,
        errors,
        trusted: event.isTrusted,
        visible: !hidden,
        tickAtRelease,
        tickAfterFeedback,
        ...(queueProfile ? { profile: queueProfile } : {}),
        timings: {
          ...(mode === 'drained' ? { drainMs } : {}),
          eventToHandlerMs: release - event.timeStamp,
          selectionReadMs: selection.elapsedMs,
          labelReadMs: labelsResult.elapsedMs,
          selectionSubmitMs: selection.submitMs,
          labelSubmitMs: labelsResult.submitMs,
          selectionReadyMs: selection.readyMs,
          labelReadyMs: labelsResult.readyMs,
          readbackReadyMs: Math.max(selection.readyMs, labelsResult.readyMs),
          highlightUpdateMs,
          labelRedrawMs,
          presentationMs,
          highlightSubmitMs: frame ? frame.submitted - highlightStart : null,
          highlightFrameMs: frame ? frame.observed - highlightStart : null,
          feedbackWithHighlightMs: frame ? Math.max(presentationMs, frame.observed - release) : null,
        },
      }
    }
    selectionLayer.onpointerdown = (event): void => {
      start = local(event)
      selectionLayer.setPointerCapture(event.pointerId)
    }
    selectionLayer.onpointerup = (event): void => {
      if (!start) return
      const end = local(event)
      const from = start
      start = undefined
      pending = replay(event, from, end, ++index)
      pending.catch(() => {})
    }
    return {
      info: device.info,
      links: scene.graph.links.length / 2,
      input: hashes,
      get tick (): number { return tick },
      result (expectedIndex: number): ReturnType<typeof replay> {
        if (!pending || index !== expectedIndex) throw new Error(`Expected release ${expectedIndex}, received ${index}`)
        return pending
      },
      isolatedCosts (): Promise<IsolatedCosts> {
        if (!profile) throw new Error('Isolated costs require the queue profile')
        return profile.isolatedCosts()
      },
      frozenDraw (targetTick: number): Promise<FrozenDraw> {
        if (!profile) throw new Error('Frozen draws require the queue profile')
        return profile.frozenDraw(targetTick)
      },
      destroy (): void {
        document.removeEventListener('visibilitychange', visibility)
        selectionLayer.remove()
        graph.destroy()
      },
    }
  } catch (error) { graph.destroy(); throw error }
}
