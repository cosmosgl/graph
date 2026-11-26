import type { ExperimentInstance } from '../../runtime/experiment'
import { mountRunLayout, disposeRunLayout } from '../../runtime/run-layout'
import { changedMembership } from '../cluster-attraction/study'
import { changedTargets } from '../point-attractors/data'
import { createIntegrated } from './runtime'
import type { IntegratedForceMode, Workload } from './data'
import { fit } from './validation'
import type * as BenchmarkView from './benchmark-view'
export async function createView (host: HTMLElement, benchmarkView?: typeof BenchmarkView): Promise<ExperimentInstance> {
  host.innerHTML = `<div data-run-part="configuration" class="scale-toolbar">
    <label>Graph <select data-kind><option>chain</option><option>communities</option><option>star</option><option>karate</option></select></label>
    <label>Points <select data-count><option>256</option><option selected>1024</option><option>8192</option></select>
      <output data-karate-count hidden>34</output></label>
${benchmarkView
    ? ''
    : `    <label>Forces <select data-forces><option value="core">Core pilot</option><option value="composed">Composed forces</option>
      <option value="composed-collision">Composed with collision</option></select></label>`}
    <p data-karate-note hidden>Karate Club uses its original 34 points and 78 weighted links.</p></div>
    ${benchmarkView?.primaryControls ?? `<div class="controls"><button class="button-primary" data-action="run" data-run-action="primary">Run</button>
    <button data-action="step" data-run-action="primary">Step</button>
    <button data-action="replace" data-run-action="primary">Reset</button>
    <button data-action="fit" data-run-action="primary">Fit</button></div>
    <p role="status" data-run-part="status">Creating the integrated WebGPU runtime…</p>`}
    <section data-run-part="visualization"><canvas width="960" height="600" aria-label="Interactive integrated WebGPU graph"
      style="width:100%;aspect-ratio:8/5;display:block;touch-action:none"></canvas>
    ${benchmarkView
    ? '<p><a href="#/integrated-webgpu">Explore the interactive graph</a></p>'
    : '<p>Click to select, drag a point to move it, drag empty space to pan, and scroll to zoom.</p>'}
    <div data-composition-controls hidden>
      <p>Hold the right mouse button over the graph to repel points, including while paused.</p>
      <div class="controls"><button data-action="update-clusters">Update cluster membership</button>
      <button data-action="update-targets">Update attractor targets</button><button data-action="clear-targets">Clear attractor targets</button></div>
      <p data-composition-status aria-live="polite"></p>
    </div></section>
    ${benchmarkView?.benchmarkControls ?? ''}`
  const canvas = host.querySelector('canvas')!; const status = host.querySelector<HTMLElement>('[role=status]')!
  const kind = host.querySelector<HTMLSelectElement>('[data-kind]')!; const count = host.querySelector<HTMLSelectElement>('[data-count]')!
  const fixedCount = host.querySelector<HTMLOutputElement>('[data-karate-count]')!
  const karateNote = host.querySelector<HTMLElement>('[data-karate-note]')!
  const runButton = host.querySelector<HTMLButtonElement>('[data-action="run"]')!
  const syncCount = (): void => {
    count.hidden = kind.value === 'karate'
    fixedCount.hidden = !count.hidden
    karateNote.hidden = !count.hidden
  }
  const selectedCount = (): number => kind.value === 'karate' ? 34 : Number(count.value)
  const forces = host.querySelector<HTMLSelectElement>('[data-forces]')
  const compositionControls = host.querySelector<HTMLElement>('[data-composition-controls]')!
  const compositionStatus = host.querySelector<HTMLElement>('[data-composition-status]')!
  let destroyed = false; let busy = false; let failure = ''
  for (const control of host.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')) control.disabled = true
  const runtime = await createIntegrated(canvas)
  runtime.resize(960, 600, devicePixelRatio)
  const benchmarks = benchmarkView?.createBenchmarks(host, runtime, kind, count, selectedCount)
  mountRunLayout(host)
  const update = (): void => {
    syncCount()
    if (!benchmarks) runButton.textContent = runtime.running ? 'Pause' : 'Run'
    compositionControls.hidden = !runtime.composition
    host.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
      button.disabled = busy && button.dataset.action !== 'cancel'
    })
    benchmarks?.update(busy)
    kind.disabled = busy; count.disabled = busy; if (forces) forces.disabled = busy
    canvas.style.pointerEvents = busy ? 'none' : 'auto'
    if (!busy) {
      const points = runtime.data.input.points.length / 4; const links = runtime.data.graph.links.length / 2
      const settings = runtime.composition?.settings
      const forceLabel = settings ? 'composed forces' : runtime.springOptimization === 'prefetch' ? 'core forces with hub prefetch' : 'core forces'
      const collisionLabel = settings?.collision ? ` · ${settings.hashedCollision ? 'hashed' : 'exact'} collision` : ''
      status.textContent = failure || runtime.error || `${runtime.running ? 'Running' : 'Paused'} · tick ${runtime.tick} · ` +
        `${points.toLocaleString()} points · ${links.toLocaleString()} links · ${forceLabel}${collisionLabel}${
          runtime.feedback.length
            ? ` · selected ${runtime.renderer.selected < 0 ? 'none' : runtime.renderer.selected}`
            : ''}`
    }
  }
  const action = async (name: string): Promise<void> => {
    if (name === 'cancel') { benchmarks?.cancel(); runtime.pause(); return }
    if (busy) return
    busy = true; failure = ''; update()
    try {
      if (name === 'run' && !benchmarks && runtime.running) runtime.pause()
      else if (name === 'run') {
        if (!benchmarks && !runtime.running && runtime.tick === 0) fit(runtime, (await runtime.backend.read()).positions)
        runtime.resume()
      } else if (name === 'pause') runtime.pause()
      else if (name === 'step') await runtime.step()
      else if (name === 'replace') {
        runtime.pause(true)
        await runtime.replace(kind.value as Workload, selectedCount(), 'hoist', (forces?.value ?? 'core') as IntegratedForceMode)
        compositionStatus.textContent = ''
      } else if (name === 'update-clusters' && runtime.composition) {
        runtime.replaceClusters(changedMembership(runtime.composition.cluster))
        compositionStatus.textContent = 'Cluster membership and targets updated.'
      } else if (name === 'update-targets' && runtime.composition) {
        runtime.replaceAttractors(changedTargets(runtime.composition.attractor))
        compositionStatus.textContent = 'Attractor targets updated.'
      } else if (name === 'clear-targets' && runtime.composition) {
        runtime.replaceAttractors({})
        compositionStatus.textContent = 'Attractor targets cleared.'
      } else if (name === 'fit') {
        runtime.pause(); fit(runtime, (await runtime.backend.read()).positions); await runtime.frame(false)
      } else await benchmarks?.run(name)
    } catch (e) {
      if (name === 'replace') {
        kind.value = runtime.data.kind
        if (kind.value !== 'karate') count.value = String(runtime.data.input.points.length / 4)
        if (forces) forces.value = runtime.forceMode
      }
      failure = String(e); status.textContent = failure
    } finally { busy = false; if (!destroyed) update() }
  }
  const abort = new AbortController()
  for (const select of [kind, count, forces]) select?.addEventListener('change', () => { action('replace') }, { signal: abort.signal })
  host.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => {
    button.addEventListener('click', () => { action(button.dataset.action!) }, { signal: abort.signal })
  })
  const timer = setInterval(update, 500); update()
  return {
    pause: (): void => { benchmarks?.cancel(); runtime.pause(true) },
    destroy: (): void => {
      destroyed = true; benchmarks?.cancel(); clearInterval(timer); abort.abort(); runtime.destroy(); disposeRunLayout(host)
    },
  }
}
