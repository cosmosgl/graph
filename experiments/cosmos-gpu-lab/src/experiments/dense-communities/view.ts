import type { Graph } from '../../../../../dist/index.js'
import { waitForGpu } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import type { ExperimentInstance } from '../../runtime/experiment'
import { ALPHA_MIN, cool } from '../combined-layout/data'
import { denseFixtureParameters } from '../million-graph/dense-communities'
import { createResidentFrameLoop } from '../million-graph/frame-loop'
import { createInteractiveFixture } from '../million-graph/interactive-fixtures'
import { observeCanvasNavigation, panCamera, zoomCamera, type ResidentCamera, type ResidentViewport } from '../million-graph/resident-navigation'
import { createComparisonCandidate, type ComparisonCandidate } from '../viewer-comparison/comparison-candidate'
import { prepareComparisonInput } from '../viewer-comparison/comparison-input'
import type { CreateDenseWebGL } from '../viewer-comparison/production-frame'

export function createDenseView (host: HTMLElement): ExperimentInstance {
  host.innerHTML = `<div class="controls">
    <button type="button" class="button-primary" data-dense-run disabled>Run</button>
    <button type="button" data-dense-fit disabled>Fit</button></div>
    <p role="status" data-dense-status>Loading the graphs…</p>
    <div class="viewer-comparison-panels dense-comparison-panels">
      <section><h2>Production WebGL</h2><div class="dense-comparison-surface" data-dense-webgl></div></section>
      <section><h2>Candidate WebGPU</h2><div class="dense-comparison-surface" data-dense-webgpu>
        <canvas aria-label="Dense communities in WebGPU"></canvas></div></section>
    </div>
    <p class="demo-note">Drag or scroll either graph to pan or zoom both.
      <a href="#/viewer-comparison?section=doc-migration-results-dense-communities-1-000-000-points-999-990-edges">Benchmark results</a>
    </p>`
  const run = host.querySelector<HTMLButtonElement>('[data-dense-run]')!
  const fit = host.querySelector<HTMLButtonElement>('[data-dense-fit]')!
  const status = host.querySelector<HTMLElement>('[data-dense-status]')!
  const glSurface = host.querySelector<HTMLElement>('[data-dense-webgl]')!
  const gpuSurface = host.querySelector<HTMLElement>('[data-dense-webgpu]')!
  const canvas = gpuSurface.querySelector('canvas')!
  const frame = document.createElement('iframe')
  frame.title = 'Dense communities in production WebGL'
  frame.tabIndex = -1
  const events = new AbortController()
  const { signal } = events
  const scope = resourceScope()
  const pixelRatio = window.devicePixelRatio || 1
  const viewport: ResidentViewport = { width: 0, height: 0, pixelRatio }
  const { circleRadius, anchorRadius, jitter } = denseFixtureParameters
  const fitCamera = (): ResidentCamera => ({
    x: 0,
    y: 0,
    zoom: 0.86 * Math.min(viewport.width, viewport.height) / (2 * (circleRadius + anchorRadius + jitter)),
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
  let alpha = 1

  const pause = (): void => { playing = false; gl?.pause(); run.textContent = 'Run' }
  const checkCooled = (): void => { if (glCooled && alpha < ALPHA_MIN) pause() }
  const fail = (label: string, error: unknown): void => {
    if (signal.aborted) return
    failed = true
    pause()
    run.disabled = fit.disabled = true
    status.hidden = false
    status.textContent = `${label} stopped. ${error instanceof Error ? error.message : String(error)}`
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
      try { await drawGpu() } catch (error) { fail('WebGPU', error) }
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
    if (alpha < ALPHA_MIN) alpha = 1
    if (glCooled) { glCooled = false; gl.start() } else gl.unpause()
    loop.request()
  }, { signal })
  fit.addEventListener('click', () => { fitted = true; camera = fitCamera(); applyCamera() }, { signal })

  const initialize = async (): Promise<void> => {
    const control = await new Promise<CreateDenseWebGL>((resolve, reject) => {
      frame.addEventListener('load', () => {
        const create = (frame.contentWindow as Window & { createDenseWebGL?: CreateDenseWebGL }).createDenseWebGL
        if (create) resolve(create)
        else reject(new Error('The production viewer could not load.'))
      }, { once: true, signal })
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      frame.src = new URL('production-viewer.html?view=dense-communities', document.baseURI).href
      glSurface.append(frame)
    })
    if (signal.aborted) return
    const input = prepareComparisonInput(createInteractiveFixture(1000000, 'dense'), 4)
    gl = scope.own(await control(input, pixelRatio, () => { glCooled = true; checkCooled() }, () => fail('WebGL', 'The context was lost.')))
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
  initialize().catch(error => fail(gl ? 'WebGPU' : 'WebGL', error))

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
