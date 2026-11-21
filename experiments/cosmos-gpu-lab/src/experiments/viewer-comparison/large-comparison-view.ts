import type { Graph } from '../../../../../dist/index.js'
import { waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import type { ExperimentInstance } from '../../runtime/experiment'
import { renderResultChart, type ResultChart } from '../../runtime/result-chart'
import { ALPHA_MIN, cool } from '../combined-layout/data'
import { denseFixtureParameters } from '../million-graph/dense-communities'
import { createResidentFrameLoop } from '../million-graph/frame-loop'
import { createInteractiveFixture, type InteractiveFixtureKind } from '../million-graph/interactive-fixtures'
import { observeCanvasNavigation, panCamera, zoomCamera, type ResidentCamera, type ResidentViewport } from '../million-graph/resident-navigation'
import { loadYoutubeFixture } from '../million-graph/youtube-fixture'
import { createComparisonCandidate, type ComparisonCandidate } from './comparison-candidate'
import { prepareComparisonInput, type ComparisonInput } from './comparison-input'
import type { CreateComparisonWebGL } from './production-frame'

type ComparisonDemo = {
  kind: InteractiveFixtureKind | 'youtube';
  title: string;
  pointCount?: number;
  youtubeTopology?: 'sparse';
  benchmark?: { href: string; chart?: ResultChart };
}

type Playback = 'both' | 'webgl' | 'webgpu'

export function createLargeComparisonView (
  host: HTMLElement, { kind, title, pointCount = 1000000, youtubeTopology, benchmark }: ComparisonDemo
): ExperimentInstance {
  const youtube = kind === 'youtube'
  const rateUnit = youtube ? 'frames/s' : 'steps/s'
  const modes: Playback[] = youtube ? ['webgl', 'webgpu', 'both'] : ['both']
  const labels = { webgl: ' WebGL', webgpu: ' WebGPU', both: youtube ? ' both' : '' }
  const playbackMarkup = modes.map(mode =>
    `<button type="button" data-comparison-run="${mode}" disabled>Run${labels[mode]}</button>`).join('')
  const playbackNote = youtube
    ? 'Each pane keeps its last rate of GPU-completed simulation frames.'
    : 'Live rates count submitted simulation steps while both graphs share the GPU.'
  host.innerHTML = `<div class="controls run-primary-actions">
    ${playbackMarkup}
    <button type="button" data-comparison-fit disabled>Fit</button></div>
    <div class="viewer-comparison-panels large-comparison-panels">
      <section><h2>Production WebGL</h2><div class="large-comparison-surface" data-comparison-webgl></div>
        <p class="comparison-step-rate" data-webgl-rate>— ${rateUnit}</p></section>
      <section><h2>Candidate WebGPU</h2><div class="large-comparison-surface" data-comparison-webgpu>
        <canvas aria-label="${title} in WebGPU"></canvas></div>
        <p class="comparison-step-rate" data-webgpu-rate>— ${rateUnit}</p></section>
    </div>
    <p role="status" data-comparison-status>${kind === 'youtube' ? 'Loading the YouTube dataset…' : 'Loading the graphs…'}</p>
    <p class="demo-note">Drag or scroll either graph to pan or zoom both. ${playbackNote}</p>`
  if (benchmark) {
    if (benchmark.chart) host.append(renderResultChart(benchmark.chart))
    const link = document.createElement('a')
    link.href = benchmark.href
    link.textContent = 'Benchmark results'
    const note = document.createElement('p')
    note.className = 'demo-note comparison-benchmark'
    note.append(link)
    host.append(note)
  }
  const playButtons = modes.map(mode => ({
    mode, button: host.querySelector<HTMLButtonElement>(`[data-comparison-run="${mode}"]`)!,
  }))
  const fit = host.querySelector<HTMLButtonElement>('[data-comparison-fit]')!
  const status = host.querySelector<HTMLElement>('[data-comparison-status]')!
  const glSurface = host.querySelector<HTMLElement>('[data-comparison-webgl]')!
  const gpuSurface = host.querySelector<HTMLElement>('[data-comparison-webgpu]')!
  const glRate = host.querySelector<HTMLElement>('[data-webgl-rate]')!
  const gpuRate = host.querySelector<HTMLElement>('[data-webgpu-rate]')!
  const canvas = gpuSurface.querySelector('canvas')!
  const frame = document.createElement('iframe')
  frame.title = `${title} in production WebGL`
  frame.tabIndex = -1
  const events = new AbortController()
  const { signal } = events
  const scope = resourceScope()
  const pixelRatio = window.devicePixelRatio || 1
  const viewport: ResidentViewport = { width: 0, height: 0, pixelRatio }
  const { circleRadius, anchorRadius, jitter } = denseFixtureParameters
  const youtubeMotionRadius = 4000
  let fitRadius = kind === 'youtube' ? 500 : circleRadius + anchorRadius + jitter
  const fitCamera = (): ResidentCamera => ({
    x: 0,
    y: 0,
    zoom: 0.86 * Math.min(viewport.width, viewport.height) / (2 * fitRadius),
  })
  let camera = fitCamera()
  let fitted = true
  let gl: Graph | undefined
  let gpu: ComparisonCandidate | undefined
  let ready = false
  let failed = false
  let playing: Playback | undefined
  let startRequest = 0
  let dirty = true
  let glCooled = false
  let tick = 0
  let glTick = 0
  let glCompleted = 0
  let gpuCompleted = 0
  let glPending: Promise<void> | undefined
  let gpuPending: Promise<void> | undefined
  let alpha = 1
  let rateTimer: number | undefined

  const updatePlayButtons = (starting?: Playback): void => {
    for (const { mode, button } of playButtons) {
      const action = mode === starting ? 'Starting' : mode === playing ? 'Pause' : 'Run'
      button.textContent = action + labels[mode]
      button.disabled = !ready || failed || signal.aborted || starting !== undefined
      button.classList.toggle('button-primary', mode === (starting ?? playing ?? 'both'))
    }
  }
  const pause = (): void => {
    startRequest++
    playing = undefined
    gl?.pause()
    window.clearInterval(rateTimer)
    if (!youtube) glRate.textContent = gpuRate.textContent = '— steps/s'
    updatePlayButtons()
  }
  const runsWebGpu = (): boolean => playing !== undefined && playing !== 'webgl' && alpha >= ALPHA_MIN
  const checkCooled = (): void => {
    const glFinished = playing === 'webgpu' || glCooled
    const gpuFinished = playing === 'webgl' || alpha < ALPHA_MIN
    if (playing && glFinished && gpuFinished) pause()
  }
  const fail = (message: string, error: unknown): void => {
    if (signal.aborted) return
    failed = true
    pause()
    fit.disabled = true
    status.hidden = false
    status.textContent = `${message} ${error instanceof Error ? error.message : String(error)}`
  }

  const drawGpu = async (): Promise<void> => {
    if (!gpu || !viewport.width || !viewport.height) return
    const { graph, drawing } = gpu
    const width = Math.max(1, Math.floor(viewport.width * pixelRatio))
    const height = Math.max(1, Math.floor(viewport.height * pixelRatio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      graph.device.canvasContext!.resize({ width, height })
    }
    drawing.camera = camera
    dirty = false
    const advances = runsWebGpu()
    if (advances) {
      graph.frame(tick++, alpha, false)
      alpha = cool(alpha, 5000)
      checkCooled()
    }
    drawing.draw()
    await waitForGpu(graph.device, 20000)
    if (advances) gpuCompleted = tick
  }
  const loop = createResidentFrameLoop({
    wantsFrame: () => ready && !signal.aborted && !failed && (dirty || runsWebGpu()),
    frame (): Promise<void> {
      gpuPending = drawGpu().catch(error => fail('WebGPU stopped.', error))
      return gpuPending
    },
  })

  const applyCamera = (): void => {
    if (gl && viewport.width && viewport.height) {
      const { width, height } = viewport
      const { x, y, zoom: k } = camera
      gl.setViewTransform({ k, x: width / 2 - k * (width / 2 + x), y: height / 2 - k * (height / 2 - y) }, [width, height])
    }
    dirty = true
    loop.request()
  }
  const resizeViews = (): void => {
    const left = glSurface.getBoundingClientRect()
    const right = gpuSurface.getBoundingClientRect()
    // Whole CSS pixels give the iframe and the canvas identical backing sizes.
    const width = Math.floor(Math.min(left.width, right.width))
    const height = Math.floor(Math.min(left.height, right.height))
    if (!width || !height || (viewport.width === width && viewport.height === height)) return
    Object.assign(viewport, { width, height })
    for (const viewer of [frame, canvas]) {
      viewer.style.width = `${width}px`
      viewer.style.height = `${height}px`
    }
    if (fitted) camera = fitCamera()
    applyCamera()
  }
  const resize = new ResizeObserver(resizeViews)
  const navigation = (surface: HTMLElement): (() => void) => observeCanvasNavigation(surface, viewport, {
    pan (dx, dy): void {
      if (!ready || failed) return
      fitted = false
      camera = panCamera(camera, dx, dy)
      applyCamera()
    },
    zoom (factor, x, y): boolean {
      if (!ready || failed) return false
      fitted = false
      camera = zoomCamera(camera, viewport, factor, x, y)
      applyCamera()
      return true
    },
  })
  const releaseGlNavigation = navigation(glSurface)
  const releaseGpuNavigation = navigation(gpuSurface)
  resize.observe(glSurface); resize.observe(gpuSurface)
  resizeViews()

  const startPlayback = async (mode: Playback): Promise<void> => {
    if (!gl || !ready || failed) return
    const pauseOnly = playing === mode
    if (playing) pause()
    if (pauseOnly) return
    if (youtube) {
      const request = ++startRequest
      updatePlayButtons(mode)
      await Promise.all([glPending, gpuPending])
      if (signal.aborted || failed || request !== startRequest) return
    }
    playing = mode
    updatePlayButtons()
    const showGl = mode !== 'webgpu'
    const showGpu = mode !== 'webgl'
    // Start on the seeded layout at rest and leave room for its expansion
    // when it first moves. Keep any camera the user positioned themselves.
    if (kind === 'youtube' && fitRadius !== youtubeMotionRadius) {
      fitRadius = youtubeMotionRadius
      if (fitted) { camera = fitCamera(); applyCamera() }
    }
    let previousTime = performance.now()
    let previousGlCount = youtube ? glCompleted : glTick
    let previousGpuCount = youtube ? gpuCompleted : tick
    const scopeLabel = youtube ? (mode === 'both' ? ' · both' : ' · solo') : ''
    if (showGl) glRate.textContent = `— ${rateUnit}${scopeLabel}`
    if (showGpu) gpuRate.textContent = `— ${rateUnit}${scopeLabel}`
    rateTimer = window.setInterval(() => {
      const now = performance.now()
      const seconds = (now - previousTime) / 1000
      const glCount = youtube ? glCompleted : glTick
      const gpuCount = youtube ? gpuCompleted : tick
      if (showGl) glRate.textContent = `${((glCount - previousGlCount) / seconds).toFixed(1)} ${rateUnit}${scopeLabel}`
      if (showGpu) gpuRate.textContent = `${((gpuCount - previousGpuCount) / seconds).toFixed(1)} ${rateUnit}${scopeLabel}`
      previousTime = now
      previousGlCount = glCount
      previousGpuCount = gpuCount
    }, youtube ? 2000 : 1000)
    if (showGpu && alpha < ALPHA_MIN) alpha = 1
    if (showGl) {
      if (glCooled) { glCooled = false; gl.start() } else gl.unpause()
    }
    loop.request()
  }
  for (const { mode, button } of playButtons) {
    button.addEventListener('click', () => { startPlayback(mode).catch(error => fail('Playback stopped.', error)) }, { signal })
  }
  fit.addEventListener('click', () => { fitted = true; camera = fitCamera(); applyCamera() }, { signal })

  const initialize = async (): Promise<void> => {
    const control = await new Promise<CreateComparisonWebGL>((resolve, reject) => {
      frame.addEventListener('load', () => {
        const create = (frame.contentWindow as Window & { createComparisonWebGL?: CreateComparisonWebGL }).createComparisonWebGL
        if (create) resolve(create)
        else reject(new Error('The production viewer could not load.'))
      }, { once: true, signal })
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      frame.src = new URL('production-viewer.html?view=large-comparison', document.baseURI).href
      glSurface.append(frame)
    })
    if (signal.aborted) return
    let scene: ComparisonInput['scene']
    try {
      scene = kind === 'youtube'
        ? await loadYoutubeFixture(pointCount, signal, youtubeTopology)
        : createInteractiveFixture(pointCount, kind)
    } catch (error) { fail('The dataset could not load.', error); return }
    if (signal.aborted) return
    status.textContent = 'Loading the graphs…'
    const input = prepareComparisonInput(scene, kind === 'youtube' ? 2 : 4)
    gl = scope.own(await control(input, pixelRatio, {
      tick (): void { glTick++ },
      frameSubmitted: youtube
        ? (completion): void => {
          const submitted = glTick
          glPending = completion.then(() => { glCompleted = Math.max(glCompleted, submitted) })
            .catch(error => fail('WebGL stopped.', error))
        }
        : undefined,
      ended (): void { glCooled = true; checkCooled() },
      lost: () => fail('WebGL stopped.', 'The context was lost.'),
    }))
    applyCamera()
    canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio))
    canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio))
    gpu = scope.own(await createComparisonCandidate(canvas, input, pixelRatio))
    await drawGpu()
    if (signal.aborted || failed) return
    ready = true
    updatePlayButtons()
    fit.disabled = false
    status.hidden = true
    loop.request()
  }
  initialize().catch(error => fail(gl ? 'WebGPU could not start.' : 'WebGL could not start.', error))

  return {
    pause,
    destroy (): void {
      events.abort()
      pause()
      loop.cancel()
      resize.disconnect()
      releaseGlNavigation(); releaseGpuNavigation()
      try { scope.destroy() } finally { frame.remove() }
    },
  }
}
