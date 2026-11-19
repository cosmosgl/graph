import { waitForGpu } from '../../gpu/luma'
import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { cool } from '../combined-layout/data'
import { createResidentChain, createResidentGraph, type Distribution } from '../many-body-grid/resident-graph'
import type { DistantForce } from '../many-body-grid/resident-cell-field'
import { createDenseCommunities } from './dense-communities'

export async function createMillionGraphView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `
    <div data-run-part="configuration">
      <label>Points <select data-count>
        <option value="65536">65,536</option><option value="262144">262,144</option>
        <option value="1000000" selected>1,000,000</option></select></label>
      <label>Starting positions <select data-distribution>
        <option value="uniform">Evenly spread</option><option value="clusters">Two dense clusters</option>
        <option value="persistent-communities">Persistent dense communities</option></select></label>
      <label>Distant repulsion <select data-force>
        <option value="per-point">Per point (current)</option><option value="cell-center">Cell center</option>
        <option value="four-corners">Four corners</option></select></label>
    </div>
    <div class="controls"><button data-run-action="primary" data-play class="button-primary">Run graph</button>
      <button data-run-action="primary" data-pause disabled>Pause</button>
      <button data-run-action="primary" data-reset>Reset</button></div>
    <p data-run-part="status" data-status role="status">Ready to run the WebGPU graph.</p>
    <section data-run-part="visualization" class="backend-panels">
      <article class="backend-panel"><h2>WebGPU · moving graph</h2>
        <canvas data-canvas width="480" height="340" aria-label="Moving WebGPU graph"></canvas>
        <p class="demo-note">The GPU fits the view as the graph moves. Points and links may overlap at this scale.</p>
      </article>
    </section>
    <p data-run-part="explanation">The graph runs for 200 cooling ticks. The hierarchy, force, positions and view remain on the GPU.
      Live ticks are not compared with WebGL; use the recorded findings for accuracy and timing checks.</p>
  `
  const get = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const count = get<HTMLSelectElement>('[data-count]'); const canvas = get<HTMLCanvasElement>('[data-canvas]')
  const distribution = get<HTMLSelectElement>('[data-distribution]'); const force = get<HTMLSelectElement>('[data-force]')
  const play = get<HTMLButtonElement>('[data-play]'); const pauseButton = get<HTMLButtonElement>('[data-pause]')
  const resetButton = get<HTMLButtonElement>('[data-reset]'); const status = get<HTMLElement>('[data-status]')
  let backend: Awaited<ReturnType<typeof createResidentGraph>> | undefined
  let running = false; let loading = false; let inFlight = false; let destroyed = false
  let tick = 0; let alpha = 1; let generation = 0; let request = 0; let error = ''
  const controls = (): void => {
    play.disabled = running || loading; pauseButton.disabled = !running; resetButton.disabled = loading
    for (const select of [count, distribution, force]) select.disabled = running || loading
    play.textContent = tick >= 200 ? 'Run again' : backend ? 'Resume' : 'Run graph'
  }
  const release = (): void => {
    generation++; running = false; cancelAnimationFrame(request); request = 0
    backend?.destroy(); backend = undefined; tick = 0; alpha = 1; error = ''
  }
  const reset = (): void => {
    release(); canvas.width = 480; controls(); status.textContent = 'Ready to run the WebGPU graph.'
  }
  const schedule = (): void => {
    if (!running || destroyed || inFlight || request) return
    request = requestAnimationFrame(() => {
      request = 0
      // eslint-disable-next-line no-void
      void step()
    })
  }
  const step = async (): Promise<void> => {
    const active = backend; const version = generation
    if (!running || !active || destroyed) return
    inFlight = true
    try {
      const start = performance.now(); active.frame(tick, alpha)
      await waitForGpu(active.device, 30000)
      if (destroyed || version !== generation) return
      tick++; alpha = cool(alpha, 200)
      if (tick >= 200) running = false
      const state = tick >= 200 ? 'Finished' : running ? 'Running' : 'Paused'
      status.textContent = `${state} · tick ${tick} / 200 · last synchronized tick ${(performance.now() - start).toFixed(1)} ms.`
    } catch (cause) {
      if (destroyed || version !== generation) return
      running = false; error = String(cause); status.textContent = `Graph stopped: ${error}`
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
        const { input, graph } = distribution.value === 'persistent-communities'
          ? createDenseCommunities(pointCount)
          : createResidentChain(pointCount, distribution.value as Distribution)
        const next = await createResidentGraph(canvas, input, graph, force.value as DistantForce)
        if (destroyed || version !== generation) { next.destroy(); return }
        backend = next; status.textContent = running ? 'Running…' : 'Paused before the first tick.'
      } catch (cause) {
        if (!destroyed && version === generation) { running = false; error = String(cause); status.textContent = `Could not start: ${error}` }
      } finally { loading = false; if (!destroyed && version === generation) { controls(); schedule() } }
    } else { status.textContent = `Running · tick ${tick} / 200.`; schedule() }
  }
  play.addEventListener('click', () => {
    // eslint-disable-next-line no-void
    void start()
  })
  pauseButton.addEventListener('click', () => {
    running = false; cancelAnimationFrame(request); request = 0; controls(); status.textContent = `Paused · tick ${tick} / 200.`
  })
  resetButton.addEventListener('click', reset)
  for (const select of [count, distribution, force]) select.addEventListener('change', reset)
  mountRunLayout(host, () => ({
    state: error ? 'Failed' : loading ? 'Preparing' : running ? 'Running' : tick >= 200 ? 'Finished' : tick ? 'Paused' : 'Ready',
    passed: 'No live validation',
    failed: error || 'None recorded',
    unchecked: 'Live ticks, interaction and production appearance.',
  }), { experiment: 'million-graph' })
  controls()
  return {
    pause (): void {
      running = false; cancelAnimationFrame(request); request = 0
      if (!destroyed) { controls(); status.textContent = `Paused · tick ${tick} / 200.` }
    },
    destroy (): void { destroyed = true; release(); disposeRunLayout(host) },
  }
}
