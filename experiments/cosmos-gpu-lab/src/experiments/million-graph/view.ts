import { describeDevice, waitForGpu } from '../../gpu/luma'
import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { cool } from '../combined-layout/data'
import { createResidentChain, createResidentGraph, type Distribution, type ResidentStageTimestamps } from '../many-body-grid/resident-graph'
import type { DistantForce } from '../many-body-grid/resident-cell-field'
import { createDenseCommunities } from './dense-communities'
import { createInteractiveFixture, type InteractiveFixture } from './interactive-fixtures'
import {
  cameraFromView, observeCanvasNavigation, panCamera, zoomCamera, type ResidentCamera, type ResidentClick,
  type ResidentViewport,
} from './resident-navigation'

type Graph = Awaited<ReturnType<typeof createResidentGraph>>
export type MovingFrame = {
  tick: number; animationTime: number; started: number; submitted: number; completed: number; camera?: ResidentCamera;
}
export type PickFeedback = {
  id: number | null; tick: number; running: boolean; trusted: boolean;
  cachedHighlight?: boolean;
  milliseconds: number; queueMs: number; readMs: number; drawMs: number; animationMs: number;
}
type Study = {
  viewport: ResidentViewport;
  fixture?: Pick<InteractiveFixture, 'input' | 'graph'>;
  pointCulling?: boolean;
  cachedHighlight?: boolean;
  depthLinks?: boolean;
  scheduleAhead?: boolean;
  callback?(animationTime: number, busy: boolean): void;
  timestamps?(tick: number): ResidentStageTimestamps | undefined;
  ready(graph: Graph, initialPositions: Float32Array, metadata?: InteractiveFixture['metadata']): void;
  submitted(): void;
  frame(frame: MovingFrame): void;
  feedback(pick: PickFeedback): void;
  failed(error: string): void;
}
type StartingView = {
  points: 65536 | 131072 | 196608 | 262144 | 393216 | 524288 | 786432 | 1000000;
  distribution: 'uniform' | 'clusters' | 'persistent-communities' | 'hubs';
  force: DistantForce;
}

export async function createMillionGraphView (host: HTMLElement, study?: Study, initialView?: StartingView): Promise<ExperimentInstance> {
  const viewport = study?.viewport ?? { width: 480, height: 340, pixelRatio: 1 }
  const startingPoints = initialView?.points ?? 1000000
  host.classList.add('million-graph')
  host.innerHTML = `
    <div data-run-part="configuration" class="scale-toolbar million-graph-settings">
      <label>Points <select data-count data-control="point-count">
        <option value="65536"${startingPoints === 65536 ? ' selected' : ''}>65,536</option>
        <option value="131072"${startingPoints === 131072 ? ' selected' : ''}>131,072</option>
        <option value="196608"${startingPoints === 196608 ? ' selected' : ''}>196,608</option>
        <option value="262144"${startingPoints === 262144 ? ' selected' : ''}>262,144</option>
        <option value="393216"${startingPoints === 393216 ? ' selected' : ''}>393,216</option>
        <option value="524288"${startingPoints === 524288 ? ' selected' : ''}>524,288</option>
        <option value="786432"${startingPoints === 786432 ? ' selected' : ''}>786,432</option>
        <option value="1000000"${startingPoints === 1000000 ? ' selected' : ''}>1,000,000</option></select></label>
      <label>Starting layout <select data-distribution>
        <option value="uniform">Evenly spread</option>
        <option value="clusters"${initialView?.distribution === 'clusters' ? ' selected' : ''}>Two dense clusters</option>
        <option value="persistent-communities"${initialView?.distribution === 'persistent-communities' ? ' selected' : ''}>Dense communities</option>
        <option value="hubs"${initialView?.distribution === 'hubs' ? ' selected' : ''}>Communities with a hub</option></select></label>
      <label>Distant repulsion <select data-force>
        <option value="per-point">Per point</option>
        <option value="cell-center"${initialView?.force === 'cell-center' ? ' selected' : ''}>Cell center</option>
        <option value="four-corners"${initialView?.force === 'four-corners' ? ' selected' : ''}>Four corners</option></select></label>
      <label>Drawing <select data-drawing>
        <option value="standard">Standard</option><option value="coverage">Reduced drawing</option></select></label>
    </div>
    <div class="controls"><button data-run-action="primary" data-play class="button-primary">Run graph</button>
      <button data-run-action="primary" data-pause disabled>Pause</button>
      <button data-run-action="primary" data-fit disabled>Fit</button>
      <button data-run-action="primary" data-reset>Reset</button></div>
    <figure data-run-part="visualization" class="million-graph-view">
      <div class="million-graph-surface">
        <canvas data-canvas width="${Math.round(viewport.width * viewport.pixelRatio)}"
          height="${Math.round(viewport.height * viewport.pixelRatio)}" aria-label="WebGPU graph"></canvas>
      </div>
      <figcaption>
        <span data-status role="status" hidden></span>
        <span data-graph-help hidden>Drag to pan · Scroll to zoom · Click a point to select it</span>
      </figcaption>
    </figure>
    <p data-run-part="explanation">The graph runs for 200 cooling ticks. The hierarchy, force, positions and view remain on the GPU.
      Live ticks are not compared with WebGL; use the recorded findings for accuracy and timing checks.</p>
  `
  const get = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const count = get<HTMLSelectElement>('[data-count]'); const canvas = get<HTMLCanvasElement>('[data-canvas]')
  const distribution = get<HTMLSelectElement>('[data-distribution]'); const force = get<HTMLSelectElement>('[data-force]')
  const drawing = get<HTMLSelectElement>('[data-drawing]')
  const settings = [count, distribution, force, drawing]
  const play = get<HTMLButtonElement>('[data-play]'); const pauseButton = get<HTMLButtonElement>('[data-pause]')
  const fitButton = get<HTMLButtonElement>('[data-fit]')
  const resetButton = get<HTMLButtonElement>('[data-reset]'); const status = get<HTMLElement>('[data-status]')
  const help = get<HTMLElement>('[data-graph-help]')
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
  const showStatus = (message: string): void => {
    status.textContent = message
    status.hidden = !message
  }
  const controls = (): void => {
    play.disabled = running || loading; pauseButton.disabled = !running; resetButton.disabled = loading
    fitButton.disabled = loading || !backend || !!error
    for (const select of settings) select.disabled = running || loading
    play.textContent = error ? 'Retry' : tick >= 200 ? 'Run again' : tick > 0 ? 'Resume' : 'Run graph'
  }
  const release = (): void => {
    generation++; running = false; cancelAnimationFrame(request); request = 0
    camera = undefined; cameraUpdates.length = 0; fitRequested = false; pendingPick = undefined; selection = null
    backend?.destroy(); backend = undefined; tick = 0; alpha = 1; error = ''
  }
  const failed = (cause: unknown): void => {
    running = false; error = String(cause); showStatus(`Graph stopped: ${error}`)
    cameraUpdates.length = 0; fitRequested = false; pendingPick = undefined
    study?.failed(error)
  }
  const schedule = (): void => {
    if (!backend || destroyed || loading || error || request || (inFlight && !study?.scheduleAhead)) return
    if (!running && !pendingPick && !fitRequested && !cameraUpdates.length) return
    request = requestAnimationFrame(animationTime => {
      request = 0
      study?.callback?.(animationTime, inFlight)
      // Keep one callback pending while the GPU works, without queuing a
      // second simulation frame or taking a pick against in-flight state.
      if (study?.scheduleAhead && running) schedule()
      if (destroyed || loading || error || inFlight) return
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
        selection = id; active.select(id)
        const cachedHighlight = active.redrawHighlight()
        study?.submitted()
        await waitForGpu(active.device, 30000)
        const highlighted = performance.now()
        await new Promise(resolve => requestAnimationFrame(resolve))
        if (destroyed || version !== generation) return
        const complete = performance.now()
        showStatus(id === null ? 'No point selected.' : `Selected point ${id}.`)
        study?.feedback({
          id,
          tick,
          running,
          trusted: click.trusted,
          cachedHighlight,
          milliseconds: complete - click.started,
          queueMs: pickStart - click.started,
          readMs: read - pickStart,
          drawMs: highlighted - read,
          animationMs: complete - highlighted,
        })
        return
      }
      const moving = running
      if (moving) active.frame(tick, alpha, true, study?.timestamps?.(tick))
      else active.redraw()
      const submitted = performance.now()
      study?.submitted()
      await waitForGpu(active.device, 30000)
      if (destroyed || version !== generation) return
      if (help.hidden) help.hidden = false
      if (!moving) return
      const completed = performance.now()
      tick++; alpha = cool(alpha, 200)
      if (tick >= 200) running = false
      const state = tick >= 200 ? 'Finished' : running ? 'Running' : 'Paused'
      const selected = selection === null ? '' : ` · selected point ${selection}`
      showStatus(`${state} · tick ${tick} / 200 · last synchronized tick ${(completed - start).toFixed(1)} ms${selected}.`)
      study?.frame({ tick, animationTime, started: start, submitted, completed, camera })
    } catch (cause) {
      if (destroyed || version !== generation) return
      failed(cause)
    } finally {
      inFlight = false
      if (!destroyed) { controls(); schedule() }
    }
  }
  const startingStatus = 'Starting layout · tick 0 / 200.'
  const prepare = async (run: boolean): Promise<void> => {
    release()
    const version = generation
    loading = true
    running = run
    help.hidden = true
    controls()
    showStatus('Preparing the WebGPU graph…')
    try {
      // Give the browser a chance to paint the status before creating the static input.
      await new Promise(resolve => requestAnimationFrame(resolve))
      if (destroyed || version !== generation) return
      const pointCount = Number(count.value)
      const fixture = !study?.fixture && distribution.value === 'hubs'
        ? createInteractiveFixture(pointCount, 'hubs')
        : study && !study.fixture && distribution.value === 'persistent-communities'
          ? createInteractiveFixture(pointCount, 'dense')
          : undefined
      const { input, graph } = study?.fixture ?? fixture ?? (distribution.value === 'persistent-communities'
        ? createDenseCommunities(pointCount)
        : createResidentChain(pointCount, distribution.value as Distribution))
      const useCoverage = drawing.value === 'coverage'
      const next = await createResidentGraph(canvas, input, graph, force.value as DistantForce, {
        pixelRatio: viewport.pixelRatio,
        picking: true,
        pointCulling: study?.pointCulling ?? useCoverage,
        cachedHighlight: study?.cachedHighlight ?? useCoverage,
        depthLinks: study?.depthLinks,
      })
      if (destroyed || version !== generation) { next.destroy(); return }
      backend = next
      next.fit()
      // The interactive study starts its render submissions with the measured run.
      if (!study) {
        next.redraw()
        await waitForGpu(next.device, 30000)
        if (destroyed || version !== generation) return
        help.hidden = false
      }
      study?.ready(next, input.points, fixture?.metadata)
      showStatus(running ? 'Running…' : startingStatus)
    } catch (cause) {
      if (destroyed || version !== generation) return
      backend?.destroy()
      backend = undefined
      failed(cause)
    } finally {
      if (!destroyed && version === generation) { loading = false; controls(); schedule() }
    }
  }
  const reset = (): void => {
    if (loading || destroyed) return
    if (study) {
      release(); help.hidden = true; showStatus(''); controls()
    } else {
      // eslint-disable-next-line no-void
      void prepare(false)
    }
  }
  const fit = (): void => { fitRequested = true; cameraUpdates.length = 0; schedule() }
  const start = async (): Promise<void> => {
    if (running || loading || destroyed) return
    if (!backend || tick >= 200 || error) { await prepare(!error); return }
    running = true; controls()
    if (tick === 0 && (camera || cameraUpdates.length)) fit()
    showStatus(`Running · tick ${tick} / 200.`); schedule()
  }
  const pause = (): void => {
    running = false; cancelAnimationFrame(request); request = 0
    controls()
    if (!loading && !error && backend) showStatus(tick === 0 ? startingStatus : `Paused · tick ${tick} / 200.`)
  }
  play.addEventListener('click', () => {
    // eslint-disable-next-line no-void
    void start()
  })
  pauseButton.addEventListener('click', () => {
    pause(); schedule()
  })
  fitButton.addEventListener('click', fit)
  resetButton.addEventListener('click', reset)
  for (const select of settings) select.addEventListener('change', reset)
  const updateCamera = (update: (camera: ResidentCamera) => ResidentCamera): boolean => {
    if (!backend || destroyed || loading || error) return false
    cameraUpdates.push(update); schedule()
    return true
  }
  const releaseNavigation = observeCanvasNavigation(canvas, viewport, {
    pan (dx, dy): void { updateCamera(camera => panCamera(camera, dx, dy)) },
    zoom: (factor, x, y): boolean => updateCamera(camera => zoomCamera(camera, viewport, factor, x, y)),
    pick (click): void { if (backend && !destroyed && !loading && !error) { pendingPick = click; schedule() } },
  })
  mountRunLayout(host, () => ({
    state: error ? 'Failed' : loading ? 'Preparing' : running ? 'Running' : tick >= 200 ? 'Finished' : tick ? 'Paused' : 'Ready',
    passed: 'No live validation',
    failed: error || 'None recorded',
    unchecked: 'Live timing, picking and production appearance.',
  }), {
    experiment: 'million-graph',
    devices: () => backend ? [describeDevice(backend.device)] : [],
    scope: 'The demo uses the selected settings. Recorded results list the settings used in each run.',
    showChecks: false,
  })
  reset()
  return {
    pause,
    destroy (): void { destroyed = true; releaseNavigation(); release(); disposeRunLayout(host); host.classList.remove('million-graph') },
  }
}
