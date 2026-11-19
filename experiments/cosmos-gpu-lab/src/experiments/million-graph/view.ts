import { waitForGpu } from '../../gpu/luma'
import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { cool } from '../combined-layout/data'
import { createResidentChain, createResidentGraph, type Distribution } from '../many-body-grid/resident-graph'
import type { DistantForce } from '../many-body-grid/resident-cell-field'
import { createDenseCommunities } from './dense-communities'
import { createInteractiveFixture, type InteractiveFixture } from './interactive-fixtures'
import {
  cameraFromView, observeCanvasNavigation, panCamera, zoomCamera, type ResidentCamera, type ResidentClick,
  type ResidentViewport,
} from './resident-navigation'

type Graph = Awaited<ReturnType<typeof createResidentGraph>>
export type MovingFrame = { tick: number; animationTime: number; started: number; completed: number; camera?: ResidentCamera }
export type PickFeedback = {
  id: number | null; tick: number; running: boolean; trusted: boolean;
  milliseconds: number; queueMs: number; readMs: number; drawMs: number; animationMs: number;
}
type Study = {
  viewport: ResidentViewport;
  ready(graph: Graph, initialPositions: Float32Array, metadata?: InteractiveFixture['metadata']): void;
  submitted(): void;
  frame(frame: MovingFrame): void;
  feedback(pick: PickFeedback): void;
  failed(error: string): void;
}

export async function createMillionGraphView (host: HTMLElement, study?: Study): Promise<ExperimentInstance> {
  const viewport = study?.viewport ?? { width: 480, height: 340, pixelRatio: 1 }
  host.innerHTML = `
    <div data-run-part="configuration">
      <label>Points <select data-count>
        <option value="65536">65,536</option><option value="131072">131,072</option>
        <option value="196608">196,608</option><option value="262144">262,144</option>
        <option value="393216">393,216</option><option value="524288">524,288</option>
        <option value="786432">786,432</option>
        <option value="1000000" selected>1,000,000</option></select></label>
      <label>Starting positions <select data-distribution>
        <option value="uniform">Evenly spread</option><option value="clusters">Two dense clusters</option>
        <option value="persistent-communities">Persistent dense communities</option>
        <option value="hubs">Persistent communities with a large hub</option></select></label>
      <label>Distant repulsion <select data-force>
        <option value="per-point">Per point (current)</option><option value="cell-center">Cell center</option>
        <option value="four-corners">Four corners</option></select></label>
    </div>
    <div class="controls"><button data-run-action="primary" data-play class="button-primary">Run graph</button>
      <button data-run-action="primary" data-pause disabled>Pause</button>
      <button data-run-action="primary" data-fit disabled>Fit</button>
      <button data-run-action="primary" data-reset>Reset</button></div>
    <p data-run-part="status" data-status role="status">Ready to run the WebGPU graph.</p>
    <section data-run-part="visualization" class="backend-panels">
      <article class="backend-panel"><h2>WebGPU · moving graph</h2>
        <canvas data-canvas width="${Math.round(viewport.width * viewport.pixelRatio)}"
          height="${Math.round(viewport.height * viewport.pixelRatio)}" aria-label="Moving WebGPU graph" style="touch-action:none"></canvas>
        <p class="demo-note">Drag to pan, scroll to zoom, or click a point. Fit follows the moving graph again.</p>
      </article>
    </section>
    <p data-run-part="explanation">The graph runs for 200 cooling ticks. The hierarchy, force, positions and view remain on the GPU.
      Live ticks are not compared with WebGL; use the recorded findings for accuracy and timing checks.</p>
  `
  const get = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const count = get<HTMLSelectElement>('[data-count]'); const canvas = get<HTMLCanvasElement>('[data-canvas]')
  const distribution = get<HTMLSelectElement>('[data-distribution]'); const force = get<HTMLSelectElement>('[data-force]')
  const play = get<HTMLButtonElement>('[data-play]'); const pauseButton = get<HTMLButtonElement>('[data-pause]')
  const fitButton = get<HTMLButtonElement>('[data-fit]')
  const resetButton = get<HTMLButtonElement>('[data-reset]'); const status = get<HTMLElement>('[data-status]')
  if (study) {
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
  }
  let backend: Graph | undefined
  let running = false; let loading = false; let inFlight = false; let destroyed = false
  let tick = 0; let alpha = 1; let generation = 0; let request = 0; let error = ''
  let camera: ResidentCamera | undefined; let fitRequested = false
  let selection: number | null = null
  let pendingPick: ResidentClick | undefined
  const cameraUpdates: Array<(camera: ResidentCamera) => ResidentCamera> = []
  const controls = (): void => {
    play.disabled = running || loading; pauseButton.disabled = !running; resetButton.disabled = loading
    fitButton.disabled = !backend
    for (const select of [count, distribution, force]) select.disabled = running || loading
    play.textContent = tick >= 200 ? 'Run again' : backend ? 'Resume' : 'Run graph'
  }
  const release = (): void => {
    generation++; running = false; cancelAnimationFrame(request); request = 0
    camera = undefined; cameraUpdates.length = 0; fitRequested = false; pendingPick = undefined; selection = null
    backend?.destroy(); backend = undefined; tick = 0; alpha = 1; error = ''
  }
  const reset = (): void => {
    release(); canvas.width = Math.round(viewport.width * viewport.pixelRatio); controls(); status.textContent = 'Ready to run the WebGPU graph.'
  }
  const failed = (cause: unknown): void => {
    running = false; error = String(cause); status.textContent = `Graph stopped: ${error}`
    cameraUpdates.length = 0; fitRequested = false; pendingPick = undefined
    study?.failed(error)
  }
  const schedule = (): void => {
    if (!backend || destroyed || inFlight || request || (!running && !pendingPick && !fitRequested && !cameraUpdates.length)) return
    request = requestAnimationFrame(animationTime => {
      request = 0
      // eslint-disable-next-line no-void
      void step(animationTime)
    })
  }
  const step = async (animationTime: number): Promise<void> => {
    const active = backend; const version = generation
    if (!active || destroyed) return
    inFlight = true
    try {
      const start = performance.now()
      if (fitRequested) { active.fit(); camera = undefined; fitRequested = false }
      if (cameraUpdates.length) {
        const updates = cameraUpdates.splice(0)
        camera ??= cameraFromView(await active.readView(), viewport.height)
        if (destroyed || version !== generation) return
        for (const update of updates) camera = update(camera)
        active.setCamera(camera)
      }
      const click = pendingPick; pendingPick = undefined
      if (click) {
        const pickStart = performance.now()
        const picking = active.pick(click.x * viewport.pixelRatio, click.y * viewport.pixelRatio)
        study?.submitted()
        const id = await picking
        const read = performance.now()
        if (destroyed || version !== generation) return
        selection = id; active.select(id); active.redraw()
        study?.submitted()
        await waitForGpu(active.device, 30000)
        const highlighted = performance.now()
        await new Promise(resolve => requestAnimationFrame(resolve))
        if (destroyed || version !== generation) return
        const complete = performance.now()
        status.textContent = id === null ? 'No point selected.' : `Selected point ${id}.`
        study?.feedback({
          id,
          tick,
          running,
          trusted: click.trusted,
          milliseconds: complete - click.started,
          queueMs: pickStart - click.started,
          readMs: read - pickStart,
          drawMs: highlighted - read,
          animationMs: complete - highlighted,
        })
        return
      }
      const moving = running
      if (moving) active.frame(tick, alpha)
      else active.redraw()
      study?.submitted()
      await waitForGpu(active.device, 30000)
      if (destroyed || version !== generation) return
      if (!moving) return
      const completed = performance.now()
      tick++; alpha = cool(alpha, 200)
      if (tick >= 200) running = false
      const state = tick >= 200 ? 'Finished' : running ? 'Running' : 'Paused'
      const selected = selection === null ? '' : ` · selected point ${selection}`
      status.textContent = `${state} · tick ${tick} / 200 · last synchronized tick ${(completed - start).toFixed(1)} ms${selected}.`
      study?.frame({ tick, animationTime, started: start, completed, camera })
    } catch (cause) {
      if (destroyed || version !== generation) return
      failed(cause)
    } finally {
      inFlight = false
      if (!destroyed) { controls(); schedule() }
    }
  }
  const start = async (): Promise<void> => {
    if (running || loading || destroyed) return
    if (tick >= 200) release()
    running = true; error = ''; controls()
    if (!backend) {
      const version = generation; loading = true; controls(); status.textContent = 'Preparing points, links and GPU resources…'
      try {
        // Give the browser a chance to paint the status before creating the static input.
        await new Promise(resolve => requestAnimationFrame(resolve))
        if (destroyed || version !== generation) return
        const pointCount = Number(count.value)
        const fixture = distribution.value === 'hubs'
          ? createInteractiveFixture(pointCount, 'hubs')
          : study && distribution.value === 'persistent-communities'
            ? createInteractiveFixture(pointCount, 'dense')
            : undefined
        const { input, graph } = fixture ?? (distribution.value === 'persistent-communities'
          ? createDenseCommunities(pointCount)
          : createResidentChain(pointCount, distribution.value as Distribution))
        const next = await createResidentGraph(canvas, input, graph, force.value as DistantForce, { pixelRatio: viewport.pixelRatio, picking: true })
        if (destroyed || version !== generation) { next.destroy(); return }
        backend = next; backend.fit(); study?.ready(backend, input.points, fixture?.metadata)
        status.textContent = running ? 'Running…' : 'Paused before the first tick.'
      } catch (cause) {
        if (!destroyed && version === generation) failed(cause)
      } finally { loading = false; if (!destroyed && version === generation) { controls(); schedule() } }
    } else { status.textContent = `Running · tick ${tick} / 200.`; schedule() }
  }
  play.addEventListener('click', () => {
    // eslint-disable-next-line no-void
    void start()
  })
  pauseButton.addEventListener('click', () => {
    running = false; cancelAnimationFrame(request); request = 0; controls(); status.textContent = `Paused · tick ${tick} / 200.`
    schedule()
  })
  fitButton.addEventListener('click', () => { fitRequested = true; cameraUpdates.length = 0; schedule() })
  resetButton.addEventListener('click', reset)
  for (const select of [count, distribution, force]) select.addEventListener('change', reset)
  const updateCamera = (update: (camera: ResidentCamera) => ResidentCamera): boolean => {
    if (!backend || destroyed) return false
    cameraUpdates.push(update); schedule()
    return true
  }
  const releaseNavigation = observeCanvasNavigation(canvas, viewport, {
    pan (dx, dy): void { updateCamera(camera => panCamera(camera, dx, dy)) },
    zoom: (factor, x, y): boolean => updateCamera(camera => zoomCamera(camera, viewport, factor, x, y)),
    pick (click): void { if (backend && !destroyed) { pendingPick = click; schedule() } },
  })
  mountRunLayout(host, () => ({
    state: error ? 'Failed' : loading ? 'Preparing' : running ? 'Running' : tick >= 200 ? 'Finished' : tick ? 'Paused' : 'Ready',
    passed: 'No live validation',
    failed: error || 'None recorded',
    unchecked: 'Live timing, picking and production appearance.',
  }), { experiment: 'million-graph' })
  controls()
  return {
    pause (): void {
      running = false; cancelAnimationFrame(request); request = 0
      if (!destroyed) { controls(); status.textContent = `Paused · tick ${tick} / 200.` }
    },
    destroy (): void { destroyed = true; releaseNavigation(); release(); disposeRunLayout(host) },
  }
}
