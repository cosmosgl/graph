import { Graph } from '@cosmos.gl/graph'
import { afterDraw, sceneDevice, uploadedPositions, type DrawFence, type SceneDevice } from './graph-device'
import type { SceneControls } from './renderer'
import type { SceneDefinition } from './types'
import { STRESS_POINT_COUNTS } from './stress-data'
import type { StressBounds, StressResponse } from './stress-data'

const mobile = matchMedia('(max-width: 700px), (hover: none) and (pointer: coarse)').matches
const initialPointCount = mobile ? 5_000_000 : 10_000_000
const initialMillions = initialPointCount / 1_000_000

export const tenMillionPoints: SceneDefinition = {
  id: 'ten-million',
  title: '10 Million Points',
  description: mobile
    ? `The benchmark starts at ${initialMillions} million points on mobile. Zoom in to explore the folds of a Clifford attractor.`
    : 'Ten million points trace the fine folds of a Clifford attractor. Zoom in to explore the detail.',
  pointCount: initialPointCount,
  linkCount: 0,
  background: '#111318',
  benchmark: true,
}

const FIRST_DRAW_TIMEOUT_MS = 10000
const usesPositionTextures = 'getPointPositionTexture' in Graph.prototype
const positionBytesPerPoint = 4 * Float32Array.BYTES_PER_ELEMENT

interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

interface PendingFrame {
  fence: DrawFence;
  first: boolean;
  readonly submittedAt: number;
}

/** Count the actual point vertices submitted by cosmos, then restore the GL methods. */
function verifyPointDraw (gl: WebGL2RenderingContext, draw: () => void): { points: number; vertices: number; calls: number } {
  let vertices = 0
  let calls = 0
  const record = (mode: number, count: number, instances = 1): void => {
    if (mode === gl.POINTS) {
      vertices += count * instances
      calls++
    }
  }
  const arrays = gl.drawArrays
  const elements = gl.drawElements
  const instancedArrays = gl.drawArraysInstanced
  const instancedElements = gl.drawElementsInstanced
  gl.drawArrays = (mode, first, count): void => { record(mode, count); arrays.call(gl, mode, first, count) }
  gl.drawElements = (mode, count, type, offset): void => { record(mode, count); elements.call(gl, mode, count, type, offset) }
  gl.drawArraysInstanced = (mode, first, count, instances): void => {
    record(mode, count, instances)
    instancedArrays.call(gl, mode, first, count, instances)
  }
  gl.drawElementsInstanced = (mode, count, type, offset, instances): void => {
    record(mode, count, instances)
    instancedElements.call(gl, mode, count, type, offset, instances)
  }
  try {
    draw()
  } finally {
    gl.drawArrays = arrays
    gl.drawElements = elements
    gl.drawArraysInstanced = instancedArrays
    gl.drawElementsInstanced = instancedElements
  }
  return { vertices, calls, points: vertices }
}

/** This benchmark renders only points, as four-vertex WebGPU triangle strips. */
function verifyPointInstances (render: () => void): ReturnType<typeof verifyPointDraw> {
  let points = 0
  let calls = 0
  let vertices = 0
  const pass = GPURenderPassEncoder.prototype
  const draw = pass.draw
  pass.draw = function (count, instances = 1, first, start): undefined {
    if (count === 4) {
      points += instances
      vertices += count * instances
      calls++
    }
    return draw.call(this, count, instances, first, start)
  }
  try { render() } finally { pass.draw = draw }
  return { points, vertices, calls }
}

async function waitForPointDraw (
  { gl }: SceneDevice,
  render: () => void,
  current: () => boolean
): Promise<ReturnType<typeof verifyPointDraw> | undefined> {
  const deadline = performance.now() + FIRST_DRAW_TIMEOUT_MS
  while (current()) {
    if (gl?.isContextLost()) throw new Error('The GPU context was lost.')
    const draw = gl ? verifyPointDraw(gl, render) : verifyPointInstances(render)
    if (gl && gl.getError() !== gl.NO_ERROR) throw new Error('A GPU error interrupted the first point draw.')
    if (draw.calls || draw.vertices) return draw
    // luma.gl can skip drawing until the point pipeline finishes linking.
    if (performance.now() >= deadline) throw new Error('The GPU did not submit the first point draw.')
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  return undefined
}

/** An upload-once Graph benchmark; never uses the procedural update loop. */
export async function createStressScene (
  container: HTMLDivElement,
  still: boolean,
  signal?: AbortSignal
): Promise<SceneControls> {
  const surface = document.createElement('div')
  surface.className = 'benchmark-surface'
  surface.tabIndex = 0
  surface.setAttribute('role', 'region')
  const cameraInstructions = 'Drag to pan, scroll or pinch to zoom. Use plus and minus to zoom, arrow keys to pan, or zero to fit.'
  surface.setAttribute('aria-label', `Point cloud. ${cameraInstructions}`)
  const panel = document.createElement('section')
  panel.className = 'benchmark-panel'
  panel.setAttribute('aria-label', 'Point rendering benchmark')
  panel.innerHTML = `
    <label class="benchmark-label" for="benchmark-count">Point count</label>
    <div class="benchmark-count-field"><select id="benchmark-count">${STRESS_POINT_COUNTS.map(count =>
    `<option value="${count}"${count === initialPointCount ? ' selected' : ''}>${(count / 1000000).toFixed(0)} million</option>`
  ).join('')}</select></div>
    <p class="benchmark-memory">${usesPositionTextures ? 'Estimated GPU data' : 'Position buffer size'} <span></span></p>
    <button class="benchmark-run" type="button">Render ${initialMillions}M points</button>
    <p class="benchmark-status" role="status">Ready to load. This test measures rendering, with the simulation off.</p>
    <div class="benchmark-verified" hidden><span>Verified points / frame</span><strong>0</strong></div>
    <dl class="benchmark-metrics">
      <div><dt>GPU-completed FPS</dt><dd data-metric="fps">—</dd></div>
      <div><dt>GPU draw time</dt><dd data-metric="gpu">—</dd></div>
      <div><dt>Time to first frame</dt><dd data-metric="load">—</dd></div>
      <div><dt>Canvas resolution</dt><dd data-metric="resolution">—</dd></div>
    </dl>
    <div class="benchmark-actions">
      <button type="button" data-action="pause" disabled>Pause redraws</button>
      <button type="button" data-action="release" disabled>Release data</button>
    </div>
    <div class="benchmark-zoom" aria-label="Camera controls">
      <button type="button" data-action="out" aria-label="Zoom out" disabled>−</button>
      <button type="button" data-action="fit" disabled>Fit view</button>
      <button type="button" data-action="in" aria-label="Zoom in" disabled>+</button>
    </div>
    <p class="benchmark-note">Full point count on every draw. No sampling or level of detail. 1× pixel ratio.</p>`
  const mobileOverlay = document.createElement('div')
  mobileOverlay.className = 'benchmark-mobile-status'
  mobileOverlay.hidden = true
  mobileOverlay.innerHTML = `
    <p role="status"></p>
    <button class="benchmark-run benchmark-mobile-retry" type="button" hidden>Retry with 1 million points</button>`
  const mobileStatus = mobileOverlay.querySelector('p')!
  const mobileRetry = mobileOverlay.querySelector('button')!
  const select = panel.querySelector<HTMLSelectElement>('select')!
  const run = panel.querySelector<HTMLButtonElement>('.benchmark-run')!
  const status = panel.querySelector<HTMLParagraphElement>('.benchmark-status')!
  const memory = panel.querySelector<HTMLSpanElement>('.benchmark-memory span')!
  const verified = panel.querySelector<HTMLDivElement>('.benchmark-verified')!
  const pointCount = verified.querySelector('strong')!
  const pauseButton = panel.querySelector<HTMLButtonElement>('[data-action="pause"]')!
  const releaseButton = panel.querySelector<HTMLButtonElement>('[data-action="release"]')!
  const zoomButtons = panel.querySelectorAll<HTMLButtonElement>('.benchmark-zoom button')
  const metric = (name: string): HTMLElement => panel.querySelector<HTMLElement>(`[data-metric="${name}"]`)!
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let paused = still || reducedMotion.matches
  let destroyed = false
  let onscreen = true
  let graph: Graph | undefined
  let device: SceneDevice | undefined
  let timer: TimerExtension | null = null
  let canvas: HTMLCanvasElement | undefined
  let worker: Worker | undefined
  let pending: PendingFrame | undefined
  let pendingTimer: WebGLQuery | undefined
  let frame = 0
  let generation = 0
  let loaded = false
  let activeCount = initialPointCount
  let bounds: StressBounds = [648, 1248, 3448, 2848]
  let loadStarted = 0
  let framesCompleted = 0
  let windowStarted = 0
  let gpuTotal = 0
  let gpuSamples = 0
  let zoom = 1
  let cameraX = 2048
  let cameraY = 2048
  let dirty = false
  const pointers = new Map<number, { x: number; y: number }>()

  const clearPointers = (): void => {
    const captured = Array.from(pointers.keys())
    pointers.clear()
    for (const id of captured) {
      if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id)
    }
    surface.style.cursor = loaded ? 'grab' : ''
  }

  const updateTarget = (): void => {
    const count = Number(select.value)
    memory.textContent = usesPositionTextures
      ? `≈ ${(count * 164 / 1000000000).toFixed(2)} GB`
      : `${(count * positionBytesPerPoint / 1000000).toLocaleString()} MB`
    run.textContent = `Render ${count / 1000000}M points`
    run.disabled = graph !== undefined && count === activeCount
  }
  const showProgress = (message: string): void => {
    status.textContent = message
    mobileStatus.textContent = message
  }
  const updatePause = (): void => {
    pauseButton.textContent = paused ? 'Resume redraws' : 'Pause redraws'
    pauseButton.setAttribute('aria-pressed', String(paused))
  }
  const resetMetrics = (now: number): void => {
    framesCompleted = 0
    gpuTotal = 0
    gpuSamples = 0
    windowStarted = now
  }
  const release = (): void => {
    generation++
    cancelAnimationFrame(frame)
    frame = 0
    worker?.terminate()
    worker = undefined
    pending?.fence.release?.()
    if (pendingTimer) device?.gl?.deleteQuery(pendingTimer)
    pending = undefined
    pendingTimer = undefined
    resetMetrics(performance.now())
    canvas?.removeEventListener('webglcontextlost', contextLost)
    device?.gpu?.removeEventListener('uncapturederror', gpuError)
    graph?.destroy()
    graph = undefined
    device = undefined
    canvas = undefined
    timer = null
    loaded = false
    clearPointers()
    surface.style.touchAction = 'auto'
    dirty = false
    verified.hidden = true
    mobileOverlay.hidden = true
    mobileRetry.hidden = true
    mobileStatus.textContent = ''
    surface.setAttribute('aria-label', `Point cloud. ${cameraInstructions}`)
    container.dispatchEvent(new CustomEvent<number | null>('benchmark-verified', { detail: null }))
    surface.removeAttribute('data-verified-points')
    surface.removeAttribute('data-verified-vertices')
    surface.removeAttribute('data-draw-calls')
    surface.removeAttribute('data-texture-size')
    run.disabled = false
    releaseButton.disabled = true
    pauseButton.disabled = true
    zoomButtons.forEach(button => { button.disabled = true })
    for (const name of ['fps', 'gpu', 'load', 'resolution']) metric(name).textContent = '—'
  }
  const fail = (message: string): void => {
    release()
    status.textContent = `${message} Try again with the same or a smaller point count.`
    mobileOverlay.hidden = false
    mobileRetry.hidden = false
    mobileStatus.textContent = message
  }
  const contextLost = (): void => { fail('The GPU context was lost.') }
  const gpuError = (event: GPUUncapturedErrorEvent): void => { fail(event.error.message) }
  const canRedraw = (): boolean => !destroyed && !paused && onscreen && !document.hidden
  const fitScale = (): number => Math.min(
    Math.max(1, surface.clientWidth) * 0.86 / (bounds[2] - bounds[0]),
    Math.max(1, surface.clientHeight) * 0.84 / (bounds[3] - bounds[1])
  )
  const setCamera = (): void => {
    if (!graph) return
    const width = Math.max(1, surface.clientWidth)
    const height = Math.max(1, surface.clientHeight)
    const scale = fitScale() * zoom
    graph.setViewTransform({
      k: scale,
      x: width * 0.5 - scale * (cameraX - 2048 + width * 0.5),
      y: height * 0.5 - scale * (2048 - cameraY + height * 0.5),
    }, [width, height])
  }
  const schedule = (): void => {
    if (!destroyed && !frame && (pending || (loaded && (dirty || canRedraw())))) frame = requestAnimationFrame(tick)
  }
  const tick = (now: number): void => {
    frame = 0
    if (destroyed || !graph || !device) return
    const { gl } = device
    if (gl?.isContextLost()) {
      contextLost()
      return
    }
    if (pending) {
      try {
        if (!pending.fence.completed()) {
          if (now - pending.submittedAt > 45000) throw new Error('The GPU could not complete this frame.')
          schedule()
          return
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : 'The GPU could not complete this frame.')
        return
      }
      pending.fence.release?.()
      if (gl && pendingTimer && timer) {
        const disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT)
        const available = !disjoint && gl.getQueryParameter(pendingTimer, gl.QUERY_RESULT_AVAILABLE)
        if (disjoint) {
          gpuTotal = 0
          gpuSamples = 0
        } else if (available) {
          gpuTotal += (gl.getQueryParameter(pendingTimer, gl.QUERY_RESULT) as number) / 1000000
          gpuSamples++
        }
        if (disjoint || available) {
          gl.deleteQuery(pendingTimer)
          pendingTimer = undefined
        }
      }
      const first = pending.first
      pending = undefined
      if (gl && gl.getError() !== gl.NO_ERROR) {
        fail('A GPU error interrupted the test.')
        return
      }
      if (first) {
        loaded = true
        surface.style.cursor = 'grab'
        surface.style.touchAction = 'none'
        verified.hidden = false
        mobileOverlay.hidden = true
        pointCount.textContent = activeCount.toLocaleString()
        surface.setAttribute('aria-label', `Point cloud with ${pointCount.textContent} points. ${cameraInstructions}`)
        container.dispatchEvent(new CustomEvent<number | null>('benchmark-verified', { detail: activeCount }))
        metric('load').textContent = `${((now - loadStarted) / 1000).toFixed(2)} s`
        pauseButton.disabled = false
        zoomButtons.forEach(button => { button.disabled = false })
        status.textContent = `${activeCount.toLocaleString()} points verified in one Cosmos draw. Simulation off.`
        metric('fps').textContent = paused ? 'Paused' : 'Measuring…'
        resetMetrics(now)
      } else framesCompleted++
      if (canRedraw() && now - windowStarted >= 1500) {
        metric('fps').textContent = (framesCompleted * 1000 / (now - windowStarted)).toFixed(1)
        metric('gpu').textContent = gpuSamples ? `${(gpuTotal / gpuSamples).toFixed(1)} ms` : 'Unavailable'
        resetMetrics(now)
      }
    }
    if (loaded && (dirty || canRedraw())) {
      dirty = false
      setCamera()
      // The timer result can lag the frame fence. Keep at most one timer pending.
      const query = gl && timer && !pendingTimer ? gl.createQuery() : null
      if (gl && query && timer) gl.beginQuery(timer.TIME_ELAPSED_EXT, query)
      graph.renderOneFrame()
      if (gl && query && timer) {
        gl.endQuery(timer.TIME_ELAPSED_EXT)
        pendingTimer = query
      }
      try { pending = { fence: afterDraw(device), first: false, submittedAt: performance.now() } } catch (error) {
        fail(error instanceof Error ? error.message : 'The GPU could not create a completion fence.')
        return
      }
    }
    schedule()
  }
  const sync = (): void => {
    updatePause()
    if (loaded) metric('fps').textContent = paused ? 'Paused' : canRedraw() ? 'Measuring…' : 'Suspended'
    resetMetrics(performance.now())
    schedule()
  }
  const preferenceChanged = (): void => {
    paused = still || reducedMotion.matches
    sync()
  }
  // Keep the world point under the old focal point under the new focal point.
  // Using the same operation for pan and zoom also supports a moving pinch center.
  const moveCamera = (nextZoom: number, fromX: number, fromY: number, toX = fromX, toY = fromY): void => {
    if (!loaded || !graph) return
    const width = Math.max(1, surface.clientWidth)
    const height = Math.max(1, surface.clientHeight)
    const previousScale = fitScale() * zoom
    const worldX = cameraX + (fromX - width / 2) / previousScale
    const worldY = cameraY - (fromY - height / 2) / previousScale
    zoom = Math.max(0.25, Math.min(64, nextZoom))
    const nextScale = fitScale() * zoom
    cameraX = worldX - (toX - width / 2) / nextScale
    cameraY = worldY + (toY - height / 2) / nextScale
    dirty = true
    schedule()
  }
  const zoomBy = (factor: number): void => {
    moveCamera(zoom * factor, surface.clientWidth / 2, surface.clientHeight / 2)
  }
  const fitView = (): void => {
    if (!loaded) return
    zoom = 1
    cameraX = (bounds[0] + bounds[2]) / 2
    cameraY = (bounds[1] + bounds[3]) / 2
    dirty = true
    schedule()
  }
  const localPoint = (event: Pick<PointerEvent, 'clientX' | 'clientY'>): { x: number; y: number } => {
    const rect = surface.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) * surface.clientWidth / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * surface.clientHeight / Math.max(1, rect.height),
    }
  }
  const onWheel = (event: WheelEvent): void => {
    if (!loaded) return
    event.preventDefault()
    const point = localPoint(event)
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1
    const delta = Math.max(-400, Math.min(400, event.deltaY * unit))
    moveCamera(zoom * Math.exp(-delta * (event.ctrlKey ? 0.008 : 0.002)), point.x, point.y)
  }
  const onPointerDown = (event: PointerEvent): void => {
    if (!loaded || pointers.size >= 2 || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault()
    surface.focus({ preventScroll: true })
    pointers.set(event.pointerId, localPoint(event))
    surface.setPointerCapture(event.pointerId)
    surface.style.cursor = 'grabbing'
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (!loaded || !pointers.has(event.pointerId)) return
    event.preventDefault()
    const previous = Array.from(pointers.values())
    pointers.set(event.pointerId, localPoint(event))
    const current = Array.from(pointers.values())
    if (previous.length === 1) {
      moveCamera(zoom, previous[0]!.x, previous[0]!.y, current[0]!.x, current[0]!.y)
    } else {
      const a = previous[0]!
      const b = previous[1]!
      const c = current[0]!
      const d = current[1]!
      const previousDistance = Math.hypot(a.x - b.x, a.y - b.y)
      const distance = Math.hypot(c.x - d.x, c.y - d.y)
      const nextZoom = previousDistance > 0 ? zoom * distance / previousDistance : zoom
      moveCamera(nextZoom, (a.x + b.x) / 2, (a.y + b.y) / 2, (c.x + d.x) / 2, (c.y + d.y) / 2)
    }
  }
  const onPointerEnd = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return
    if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
    surface.style.cursor = pointers.size ? 'grabbing' : loaded ? 'grab' : ''
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!loaded || event.ctrlKey || event.altKey || event.metaKey) return
    if (event.key === '+' || event.key === '=') zoomBy(1.6)
    else if (event.key === '-' || event.key === '_') zoomBy(1 / 1.6)
    else if (event.key === '0' || event.key === 'Home') fitView()
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      const step = event.shiftKey ? 100 : 40
      const x = surface.clientWidth / 2
      const y = surface.clientHeight / 2
      moveCamera(zoom, x, y,
        x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
        y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0))
    } else return
    event.preventDefault()
  }
  const load = async (): Promise<void> => {
    release()
    const count = Number(select.value)
    activeCount = count
    const ownGeneration = generation
    const current = (): boolean => !destroyed && ownGeneration === generation
    loadStarted = performance.now()
    zoom = 1
    cameraX = 2048
    cameraY = 2048
    run.disabled = true
    releaseButton.disabled = false
    mobileOverlay.hidden = false
    showProgress('Preparing the GPU…')
    try {
      graph = new Graph(surface, {
        enableSimulation: false,
        enableRenderLoop: false,
        transitionDuration: 0,
        rescalePositions: false,
        fitViewOnInit: false,
        spaceSize: 4096,
        backgroundColor: '#111318',
        pointDefaultSize: 1,
        pointDefaultColor: [0.25, 0.79, 0.94, 0.035],
        pointOcclusionCulling: false,
        scalePointsOnZoom: false,
        renderLinks: false,
        renderHoveredPointRing: false,
        enableDrag: false,
        enableZoom: false,
        pixelRatio: 1,
        attribution: '',
      })
      await graph.ready
      if (!current()) return
      canvas = surface.querySelector('canvas')!
      device = sceneDevice(graph, canvas)
      const { gl, gpu } = device
      const side = Math.ceil(Math.sqrt(count))
      if (gl) {
        canvas.addEventListener('webglcontextlost', contextLost)
        if ((gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) < side) throw new Error(`This GPU cannot hold the ${side} × ${side} position texture.`)
        timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
      } else {
        gpu.addEventListener('uncapturederror', gpuError)
        gpu.lost.then(info => { if (current()) fail(info.message || 'The GPU device was lost.') })
        const positionBytes = count * positionBytesPerPoint
        const limit = gpu.limits.maxStorageBufferBindingSize
        if (positionBytes > limit) {
          throw new Error(`The positions need ${positionBytes.toLocaleString()} bytes. This device allows ${limit.toLocaleString()} per storage binding.`)
        }
      }
      worker = new Worker(new URL('./stress.worker.ts', import.meta.url), { type: 'module' })
      worker.onerror = (): void => { if (current()) fail('Point generation failed.') }
      worker.onmessage = (event: MessageEvent<StressResponse>): void => {
        if (!current()) return
        const message = event.data
        if (message.type === 'progress') {
          showProgress(`Generating ${message.generated.toLocaleString()} / ${count.toLocaleString()} points…`)
        } else if (message.type === 'error') fail(message.message)
        else {
          worker?.terminate()
          worker = undefined
          if (message.positions.length !== count * 2) {
            fail('The generated point count did not match the request.')
            return
          }
          bounds = message.bounds
          cameraX = (bounds[0] + bounds[2]) / 2
          cameraY = (bounds[1] + bounds[3]) / 2
          showProgress('Uploading points and waiting for the first completed GPU frame…')
          const drawFirstFrame = async (): Promise<void> => {
            if (!current() || !graph || !device) return
            const drawingGraph = graph
            const context = device
            try {
              drawingGraph.setPointPositions(message.positions)
              drawingGraph.render(0, 0)
              const storage = uploadedPositions(drawingGraph)
              if (storage?.pointCount !== count || (context.gl && storage.textureSize !== side)) {
                throw new Error('The GPU point storage has an unexpected count.')
              }
              const draw = await waitForPointDraw(context, () => {
                setCamera()
                drawingGraph.renderOneFrame()
              }, current)
              if (!draw || !current()) return
              if (draw.points !== count || draw.calls !== 1) throw new Error('The point draw did not submit the full requested count.')
              surface.setAttribute('data-verified-points', String(draw.points))
              surface.setAttribute('data-verified-vertices', String(draw.vertices))
              surface.setAttribute('data-draw-calls', String(draw.calls))
              if (storage.textureSize !== undefined) surface.setAttribute('data-texture-size', String(storage.textureSize))
              metric('resolution').textContent = `${canvas!.width} × ${canvas!.height}`
              pending = { fence: afterDraw(context), first: true, submittedAt: performance.now() }
              schedule()
            } catch (error) {
              if (current()) fail(error instanceof Error ? error.message : 'The GPU could not initialize this point count.')
            }
          }
          // Let the loading message paint before the large, synchronous engine upload.
          requestAnimationFrame(() => requestAnimationFrame(drawFirstFrame))
        }
      }
      worker.postMessage({ count, seed: 42 })
    } catch (error) {
      if (current()) fail(error instanceof Error ? error.message : 'The renderer could not initialize.')
    }
  }
  const start = (): void => {
    if (destroyed || run.disabled) return
    load().catch((error: unknown) => {
      if (!destroyed) fail(error instanceof Error ? error.message : 'Could not start the benchmark.')
    })
  }
  run.addEventListener('click', start)
  mobileRetry.addEventListener('click', () => {
    select.value = String(STRESS_POINT_COUNTS[0])
    updateTarget()
    start()
    surface.focus({ preventScroll: true })
  })
  releaseButton.addEventListener('click', () => {
    release()
    status.textContent = 'Data released. Choose a count to run another test.'
  })
  select.addEventListener('change', updateTarget)
  pauseButton.addEventListener('click', () => { paused = !paused; sync() })
  zoomButtons.forEach(button => button.addEventListener('click', () => {
    const action = button.getAttribute('data-action')
    if (action === 'fit') fitView()
    else zoomBy(action === 'in' ? 1.6 : 1 / 1.6)
  }))
  surface.addEventListener('wheel', onWheel, { passive: false })
  surface.addEventListener('pointerdown', onPointerDown)
  surface.addEventListener('pointermove', onPointerMove)
  surface.addEventListener('pointerup', onPointerEnd)
  surface.addEventListener('pointercancel', onPointerEnd)
  surface.addEventListener('lostpointercapture', onPointerEnd)
  surface.addEventListener('keydown', onKeyDown)
  const resizeObserver = new ResizeObserver(() => {
    if (loaded && canvas) {
      metric('resolution').textContent = `${surface.clientWidth} × ${surface.clientHeight}`
      dirty = true
      schedule()
    }
  })
  const intersectionObserver = new IntersectionObserver(entries => {
    onscreen = entries[0]?.isIntersecting ?? false
    sync()
  })
  const controls: SceneControls = {
    setPaused: (value): void => { paused = value; sync() },
    destroy: (): void => {
      if (destroyed) return
      destroyed = true
      release()
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      document.removeEventListener('visibilitychange', sync)
      reducedMotion.removeEventListener('change', preferenceChanged)
      signal?.removeEventListener('abort', controls.destroy)
      surface.removeEventListener('wheel', onWheel)
      surface.removeEventListener('pointerdown', onPointerDown)
      surface.removeEventListener('pointermove', onPointerMove)
      surface.removeEventListener('pointerup', onPointerEnd)
      surface.removeEventListener('pointercancel', onPointerEnd)
      surface.removeEventListener('lostpointercapture', onPointerEnd)
      surface.removeEventListener('keydown', onKeyDown)
      panel.remove()
      mobileOverlay.remove()
      surface.remove()
    },
  }
  if (signal?.aborted || !container.isConnected) {
    controls.destroy()
    return controls
  }
  container.append(surface, panel, mobileOverlay)
  resizeObserver.observe(surface)
  intersectionObserver.observe(surface)
  document.addEventListener('visibilitychange', sync)
  reducedMotion.addEventListener('change', preferenceChanged)
  signal?.addEventListener('abort', controls.destroy, { once: true })
  updateTarget()
  updatePause()
  queueMicrotask(start)
  return controls
}
