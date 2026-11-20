import type { Graph } from '../../../../../dist/index.js'
import { waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import type { ExperimentInstance } from '../../runtime/experiment'
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
  benchmarkSection: string;
  frameIntervals?: { webglMs: number; webgpuMs: number };
}

export function createLargeComparisonView (
  host: HTMLElement, { kind, title, pointCount = 1000000, benchmarkSection, frameIntervals }: ComparisonDemo
): ExperimentInstance {
  const benchmarkSummary = frameIntervals
    ? `Separate M3 runs · 95th-percentile frame interval during steady motion ·
      WebGL <strong>${frameIntervals.webglMs.toFixed(1)} ms</strong> · WebGPU <strong>${frameIntervals.webgpuMs.toFixed(1)} ms</strong>.`
    : ''
  host.innerHTML = `<div class="controls">
    <button type="button" class="button-primary" data-comparison-run disabled>Run</button>
    <button type="button" data-comparison-fit disabled>Fit</button></div>
    <p role="status" data-comparison-status>${kind === 'youtube' ? 'Loading the YouTube dataset…' : 'Loading the graphs…'}</p>
    <div class="viewer-comparison-panels large-comparison-panels">
      <section><h2>Production WebGL</h2><div class="large-comparison-surface" data-comparison-webgl></div>
        <p class="comparison-step-rate" data-webgl-rate>— steps/s</p></section>
      <section><h2>Candidate WebGPU</h2><div class="large-comparison-surface" data-comparison-webgpu>
        <canvas aria-label="${title} in WebGPU"></canvas></div>
        <p class="comparison-step-rate" data-webgpu-rate>— steps/s</p></section>
    </div>
    <p class="demo-note">Drag or scroll either graph to pan or zoom both. Live rates count submitted simulation steps while both graphs share the GPU.</p>
    <p class="demo-note comparison-benchmark">${benchmarkSummary}
      <a href="#/viewer-comparison?section=doc-migration-results-${benchmarkSection}">Benchmark results</a>
    </p>`
  const run = host.querySelector<HTMLButtonElement>('[data-comparison-run]')!
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
  let playing = false
  let dirty = true
  let glCooled = false
  let tick = 0
  let glTick = 0
  let alpha = 1
  let rateTimer: number | undefined

  const pause = (): void => {
    playing = false
    gl?.pause()
    window.clearInterval(rateTimer)
    glRate.textContent = gpuRate.textContent = '— steps/s'
    run.textContent = 'Run'
  }
  const checkCooled = (): void => { if (glCooled && alpha < ALPHA_MIN) pause() }
  const fail = (message: string, error: unknown): void => {
    if (signal.aborted) return
    failed = true
    pause()
    run.disabled = fit.disabled = true
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
    if (playing && alpha >= ALPHA_MIN) {
      graph.frame(tick++, alpha, false)
      alpha = cool(alpha, 5000)
      checkCooled()
    }
    drawing.draw()
    await waitForGpu(graph.device, 20000)
  }
  const loop = createResidentFrameLoop({
    wantsFrame: () => ready && !signal.aborted && !failed && (dirty || (playing && alpha >= ALPHA_MIN)),
    async frame (): Promise<void> {
      try { await drawGpu() } catch (error) { fail('WebGPU stopped.', error) }
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

  run.addEventListener('click', () => {
    if (!gl || !ready || failed) return
    if (playing) { pause(); return }
    playing = true
    run.textContent = 'Pause'
    // Start on the seeded layout at rest and leave room for its expansion
    // when it first moves. Keep any camera the user positioned themselves.
    if (kind === 'youtube' && fitRadius !== youtubeMotionRadius) {
      fitRadius = youtubeMotionRadius
      if (fitted) { camera = fitCamera(); applyCamera() }
    }
    let previousTime = performance.now()
    let previousGlTick = glTick
    let previousGpuTick = tick
    rateTimer = window.setInterval(() => {
      const now = performance.now()
      const seconds = (now - previousTime) / 1000
      glRate.textContent = `${((glTick - previousGlTick) / seconds).toFixed(1)} steps/s`
      gpuRate.textContent = `${((tick - previousGpuTick) / seconds).toFixed(1)} steps/s`
      previousTime = now
      previousGlTick = glTick
      previousGpuTick = tick
    }, 1000)
    if (alpha < ALPHA_MIN) alpha = 1
    if (glCooled) { glCooled = false; gl.start() } else gl.unpause()
    loop.request()
  }, { signal })
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
      scene = kind === 'youtube' ? await loadYoutubeFixture(pointCount, signal) : createInteractiveFixture(pointCount, kind)
    } catch (error) { fail('The dataset could not load.', error); return }
    if (signal.aborted) return
    status.textContent = 'Loading the graphs…'
    const input = prepareComparisonInput(scene, kind === 'youtube' ? 2 : 4)
    gl = scope.own(await control(input, pixelRatio, {
      tick (): void { glTick++ },
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
    run.disabled = fit.disabled = false
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
