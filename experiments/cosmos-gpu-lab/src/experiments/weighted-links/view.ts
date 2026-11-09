import type { ExperimentInstance } from '../../runtime/experiment'
import { createPassDiagnostic } from './diagnostic'
import { buildTopology, createFixture, FIXTURES, PARAMETERS, type Fixture } from './data'
import { compare, referenceTick } from './reference'
import type { LinkBackend, RenderProbe } from './backend'
import { createSweepGraph, createSweepPlan, measureStages, runSweep, validateTrajectory, type SweepRow, type TimingRow } from './sweep'
import { gpuMedian, median, TIMING_POLICY } from './timing'
import { createWebGLBackend } from './webgl'
import { createWebGPUBackend } from './webgpu'

function timingTable (rows: TimingRow[]): string {
  return `<table><thead><tr><th>Backend</th><th>Stage</th><th>Batch</th><th>CPU submit ms</th><th>Completion ms</th><th>GPU ms</th></tr></thead><tbody>
    ${rows.map(row => `<tr><td>${row.backend}</td><td>${row.stage}</td><td>${row.operations}</td>
      <td>${median(row.samples.map(s => s.submitMs)).toFixed(4)}</td>
      <td>${median(row.samples.map(s => s.completionMs)).toFixed(4)}</td>
      <td>${gpuMedian(row.samples)?.toFixed(4) ?? 'unavailable / invalid'}</td></tr>`).join('')}</tbody></table>`
}

export async function createWeightedLinksExperiment (host: HTMLElement): Promise<ExperimentInstance> {
  const diagnostic = new URLSearchParams(window.location.search).get('linkDiagnostic')
  if (diagnostic === 'WebGL' || diagnostic === 'WebGPU') return await createPassDiagnostic(host, diagnostic)
  host.innerHTML = `
    <section class="scale-toolbar">
      <label>Graph <select data-control="fixture">
        ${FIXTURES.map(name => `<option ${name === 'star' ? 'selected' : ''}>${name}</option>`).join('')}
      </select></label>
      <label>Points <select data-control="count">
        ${[32, 128, 512, 2048].map(n => `<option ${n === 128 ? 'selected' : ''}>${n}</option>`).join('')}
      </select></label>
      <label class="checkbox-control"><input type="checkbox" data-control="collision"> Collision rest-length floor</label>
    </section>
    <div class="demo-toolbar">
      <div class="controls">
        <button class="button-primary" data-action="step">Step + validate</button><button data-action="ten">10 validated ticks</button>
        <button data-action="reset">Reset</button><button data-action="topology">Replace links + reset</button>
        <button data-action="benchmark">Measure stages</button>
        <button data-action="stop" disabled>Stop</button><button data-action="restart" hidden>Restart devices</button>
        <button data-action="export" disabled>Export JSON</button>
      </div>
    </div>
    <details class="advanced-controls">
      <summary>Sweeps and WebGL diagnostics</summary>
    <section class="scale-toolbar">
      <label>Sweep backend <select data-control="sweep-backend"><option>Both</option><option>WebGL</option><option>WebGPU</option></select></label>
      <label>Sweep topology <select data-control="sweep-shape">
        <option value="all">All four</option>${['chain', 'star', 'clusters', 'hubs'].map(s => `<option>${s}</option>`).join('')}
      </select></label>
      <label>Sweep point count <select data-control="sweep-count">
        <option value="all">All in range</option>${[1000, 10000, 50000, 100000].map(n => `<option>${n}</option>`).join('')}
      </select></label>
      <label>WebGL spring loop <select data-control="spring-loop">
        <option value="original">Cosmos directional bounds</option><option value="early-exit">Stop at point degree</option>
      </select></label>
    </section>
      <div class="controls">
        <button data-action="sweep-small">Sweep 1k–10k</button><button data-action="sweep-large">Sweep 1k–100k</button>
        <button data-action="diagnose-render">Check WebGL rendering only</button>
        <button data-action="check-star">Check 100k star (Cosmos bounds)</button>
      </div>
      <p class="demo-note">Isolate simulation passes with one active device:
        <a href="?linkDiagnostic=WebGL#/weighted-links">WebGL only</a> ·
        <a href="?linkDiagnostic=WebGPU#/weighted-links">WebGPU only</a>.</p>
    </details>
    <section class="summary" aria-live="polite">
      <span>Tick <strong data-output="tick">0</strong></span><span data-output="graph"></span><span data-output="topology"></span>
    </section>
    <section class="backend-panels">
      ${['WebGL', 'WebGPU'].map(name => `<article class="backend-panel">
        <div class="panel-heading"><div>
          <p class="eyebrow" data-kernel="${name}">
            ${name === 'WebGL' ? 'luma Model · Cosmos directional GLSL' : 'luma v10 Kernel + RenderKernel'}</p><h2>${name}</h2>
        </div><span class="status" data-status="${name}">Starting…</span></div>
        <canvas data-canvas="${name}" width="480" height="340"></canvas><p class="demo-note" data-info="${name}"></p>
      </article>`).join('')}
    </section>
    <p class="demo-note">Both directions retain input link order. One tick = source-side spring → integrate → target-side spring → integrate → draw.
      Validation reads both forces and both position substeps. The measured tick has no position readback or CPU reference work.
      Orange points are pinned; absent points and their incident links are hidden.</p>
    <p data-output="status" role="status">Creating backends…</p>
    <div class="markdown-body" data-output="results"></div>
  `
  const el = <T extends HTMLElement>(selector: string): T => {
    const result = host.querySelector<T>(selector)
    if (!result) throw new Error(`Missing ${selector}`)
    return result
  }
  const fixture = el<HTMLSelectElement>('[data-control="fixture"]')
  const count = el<HTMLSelectElement>('[data-control="count"]')
  const collision = el<HTMLInputElement>('[data-control="collision"]')
  const status = el<HTMLElement>('[data-output="status"]')
  const backends: LinkBackend[] = []
  let destroyed = false; let deviceFailed = false; let stop = false; let busy = false; let changed = false; let ticks = 0
  let graph = createFixture('star'); let topology = buildTopology(graph)
  let params = { ...PARAMETERS }; let cpu = graph.points
  let capture: Record<string, unknown> | undefined
  const validation: Array<Record<string, unknown>> = []
  const disable = (value: boolean): void => {
    host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select').forEach(control => {
      control.disabled = value || deviceFailed
    })
    el<HTMLButtonElement>('[data-action="export"]').disabled = value || !capture
    el<HTMLButtonElement>('[data-action="stop"]').disabled = !value || !busy
    const restart = el<HTMLButtonElement>('[data-action="restart"]')
    restart.hidden = !deviceFailed; restart.disabled = value
    count.disabled = value || deviceFailed || fixture.value === 'pair' || fixture.value === 'edge-cases'
  }
  const cleanup = (): void => { backends.splice(0).forEach(backend => backend.destroy()) }
  const task = async (run: () => Promise<void> | void): Promise<void> => {
    if (busy || destroyed) return
    busy = true; stop = false; disable(true)
    try { await run() } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/context lost|device lost|external Instance/i.test(message)) deviceFailed = true
      if (!destroyed) status.textContent = message
    } finally {
      busy = false
      if (destroyed) cleanup(); else disable(false)
    }
  }
  const makeCapture = (extra: Record<string, unknown> = {}): void => {
    capture = {
      experiment: 'weighted-links',
      capturedAt: new Date().toISOString(),
      luma: '10.0.0-alpha.4',
      browser: navigator.userAgent,
      devices: backends.map(b => ({ backend: b.name, info: b.info })),
      fixture: fixture.value,
      count: graph.points.length / 4,
      links: topology.links.length / 2,
      changedTopology: changed,
      parameters: params,
      webglSpringLoop: el<HTMLSelectElement>('[data-control="spring-loop"]').value,
      tolerance: { absolute: 2e-6, relative: 2e-5 },
      validation: [...validation],
      ...extra,
    }
  }
  const reset = (): void => {
    ticks = 0; cpu = graph.points.slice(); validation.length = 0; capture = undefined
    for (const backend of backends) {
      backend.reset(); backend.render()
      el<HTMLElement>(`[data-status="${backend.name}"]`).textContent = 'Ready'
    }
    el<HTMLElement>('[data-output="tick"]').textContent = '0'
    el<HTMLElement>('[data-output="results"]').replaceChildren()
    status.textContent = 'Ready. Validate both directional forces and integration substeps against the CPU.'
  }
  const configure = (): void => {
    graph = createFixture(fixture.value as Fixture, Number(count.value), changed); topology = buildTopology(graph)
    params = { ...PARAMETERS, collision: collision.checked }
    for (const backend of backends) {
      backend.setGraph(graph, topology, params)
      el<HTMLElement>(`[data-info="${backend.name}"]`).textContent = backend.info
    }
    el<HTMLElement>('[data-kernel="WebGL"]').textContent = el<HTMLSelectElement>('[data-control="spring-loop"]').value === 'early-exit'
      ? 'luma Model · early-exit variant'
      : 'luma Model · Cosmos directional GLSL'
    el<HTMLElement>('[data-output="graph"]').textContent =
      `${graph.points.length / 4} points · ${topology.links.length / 2} valid links · max degree ${topology.maxDegree}`
    el<HTMLElement>('[data-output="topology"]').textContent = `CPU CSR build ${topology.buildMs.toFixed(2)} ms`
    reset()
  }
  const step = async (): Promise<boolean> => {
    const expected = referenceTick(graph, cpu, params)
    for (const backend of backends) backend.step()
    const results = await Promise.all(backends.map(async backend => ({ backend: backend.name, snapshot: await backend.read() })))
    if (destroyed) return false
    ticks++; cpu = expected.positions
    const checks = results.map(r => ({ backend: r.backend, ...compare(r.snapshot, expected) }))
    const pair = results.length === 2 ? compare(results[0].snapshot, results[1].snapshot) : undefined
    const valid = checks.length > 0 && checks.every(r => r.valid) && (pair?.valid ?? true)
    validation.push({ tick: ticks, checks, crossBackend: pair })
    for (const check of checks) {
      el<HTMLElement>(`[data-status="${check.backend}"]`).textContent = `${check.valid ? 'PASS' : 'FAIL'} · max Δ ${check.maxError.toExponential(2)}`
    }
    el<HTMLElement>('[data-output="tick"]').textContent = String(ticks)
    status.textContent = `${valid ? 'PASS' : 'FAIL'} · all points, both forces and both substeps · ${backends.length}/2 backends${
      pair ? ` · WebGL/WebGPU max Δ ${pair.maxError.toExponential(2)}` : ''}`
    makeCapture()
    return valid
  }
  const cancelled = (): boolean => destroyed || stop
  const progress = (text: string): void => { if (!destroyed) status.textContent = text }
  const diagnoseRender = async (): Promise<void> => {
    const backend = backends.find(b => b.name === 'WebGL')
    if (!backend?.diagnoseRender) throw new Error('WebGL unavailable')
    const input = createSweepGraph({ count: 100000, shape: 'star' })
    const rows: RenderProbe[] = []
    let error: string | undefined
    try {
      backend.setGraph(input, buildTopology(input), params)
      await backend.synchronize()
      await backend.diagnoseRender(progress, rows, cancelled)
    } catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
    if (destroyed) return
    if (!error) {
      try { configure() } catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
    }
    el<HTMLElement>('[data-output="results"]').innerHTML = `<h3>100k star · rendering only</h3>
      <p>Initial positions; no spring or integration draws and no timer queries. Completion includes full image readback.</p>
      <table><thead><tr><th>Mode</th><th>Vertices/draw</th><th>Completion ms</th><th>Image checksum</th>
      <th>Colored pixels</th><th>Exact image match</th></tr></thead><tbody>
      ${rows.map(row => `<tr><td>${row.mode}</td><td>${row.verticesPerDraw || 'all'}</td><td>${row.completionMs.toFixed(3)}</td>
        <td>${row.checksum}</td><td>${row.coloredPixels}</td><td>${row.matchesBounded ? 'yes' : 'no'}</td></tr>`).join('')}</tbody></table>`
    makeCapture({ mode: 'render-diagnostic', count: 100000, fixture: 'star', links: 99999, renderProbes: rows, cancelled: stop, error })
    status.textContent = error || (stop
      ? 'Render check stopped; partial export available.'
      : `Render check complete · ${rows.every(row => row.matchesBounded) ? 'identical images' : 'image mismatch'} for single and bounded draws.`)
    if (error) deviceFailed = true
  }
  const benchmark = async (): Promise<void> => {
    reset()
    const checks = await validateTrajectory(backends, graph, params, cancelled, progress)
    if (destroyed) return
    if (checks.some(check => !check.valid)) {
      makeCapture({ validation: checks }); status.textContent = 'Validation failed; timing was not run.'; return
    }
    const rows: TimingRow[] = []
    await measureStages(backends, cancelled, progress, rows)
    if (destroyed) return
    reset()
    el<HTMLElement>('[data-output="results"]').innerHTML = `<h3>Batched stage timing · median of ${TIMING_POLICY.samples} samples</h3>
      <p>All times are per operation. Force and integration each include both directions. Tick includes all four passes and rendering.
      Every operation uses identical starting data; reset, preparation and validation are outside the timer.</p>${timingTable(rows)}
      <p>Completion includes synchronization overhead. GPU queries exclude readback; unavailable or disjoint results remain unavailable.</p>`
    makeCapture({ validation: checks, measurements: rows, cancelled: stop, policy: TIMING_POLICY })
    status.textContent = stop ? 'Stopped; completed stages can be exported.' : 'Measurement complete; simulation reset. Export JSON for local analysis.'
  }
  const sweep = async (large: boolean): Promise<void> => {
    reset()
    const backendChoice = el<HTMLSelectElement>('[data-control="sweep-backend"]').value
    const shapeChoice = el<HTMLSelectElement>('[data-control="sweep-shape"]').value
    const countChoice = el<HTMLSelectElement>('[data-control="sweep-count"]').value
    const selected = backends.filter(b => backendChoice === 'Both' || b.name === backendChoice)
    if (selected.length !== (backendChoice === 'Both' ? 2 : 1)) throw new Error('Selected backend is unavailable')
    const plan = createSweepPlan(large).filter(item => (shapeChoice === 'all' || item.shape === shapeChoice) &&
      (countChoice === 'all' || item.count === Number(countChoice)))
    if (!plan.length) throw new Error('The selected point count is outside this sweep range')
    const rows: SweepRow[] = []
    let error: unknown
    let restoreFailed = false
    try { await runSweep(selected, plan, cancelled, progress, rows, params) } catch (caught) { error = caught }
    if (destroyed) return
    // Restore the interactive fixture after large resources have been used. Keep partial captures on cancellation/failure.
    if (!error) {
      try { configure() } catch (caught) { error = caught; restoreFailed = true }
    }
    const tickTime = (row: SweepRow, backend: string): number | null => {
      const timing = row.timings.find(t => t.backend === backend && t.stage === 'tick')
      return timing ? gpuMedian(timing.samples) : null
    }
    el<HTMLElement>('[data-output="results"]').innerHTML = `<h3>Topology sweep · ${rows.length}/${plan.length} cases</h3>
      <p>Identical positions, weights and V−1 links at each point count. Full CPU validation at ticks 1, 10 and 25 gates timing.</p>
      <table><thead><tr><th>Points</th><th>Topology</th><th>Max degree</th><th>Outcome</th><th>CSR ms</th>
        <th>WebGL tick GPU ms</th><th>WebGPU tick GPU ms</th></tr></thead><tbody>
      ${rows.map(row => `<tr><td>${row.count.toLocaleString()}</td><td>${row.shape}</td><td>${row.maxDegree}</td><td>${row.status}</td>
        <td>${median(row.topologyBuildMs).toFixed(3)}</td><td>${tickTime(row, 'WebGL')?.toFixed(4) ?? '—'}</td>
        <td>${tickTime(row, 'WebGPU')?.toFixed(4) ?? '—'}</td></tr>`).join('')}</tbody></table>
      <p>A dash means no valid complete GPU timing set; it never means zero. Resource setup and upload-call costs are separate in the capture.</p>
      <details><summary>Resource setup and upload calls</summary>
        <p>One recreation per case/backend. CPU upload-call time includes texture allocation on WebGL; it is not GPU transfer time.</p>
        <table><thead><tr><th>Case</th><th>Backend</th><th>Setup submit ms</th><th>Upload calls ms</th><th>Setup completion ms</th></tr></thead><tbody>
        ${rows.flatMap(row => row.setup.map(setup => `<tr><td>${row.shape} · ${row.count.toLocaleString()}</td><td>${setup.backend}</td>
          <td>${setup.setupSubmitMs.toFixed(3)}</td><td>${setup.uploadCallMs.toFixed(3)}</td><td>${setup.completionMs.toFixed(3)}</td></tr>`)).join('')}
        </tbody></table>
      </details>
      <details><summary>All stage measurements</summary>${rows.map(row => `<h4>${row.shape} · ${row.count.toLocaleString()} points</h4>
        ${timingTable(row.timings)}`).join('')}</details>`
    makeCapture({
      mode: 'topology-sweep',
      fixture: undefined,
      count: undefined,
      links: undefined,
      changedTopology: undefined,
      plan,
      selectedBackends: selected.map(backend => backend.name),
      sweep: rows,
      error: error === undefined ? undefined : error instanceof Error ? error.message : String(error),
      errorPhase: restoreFailed ? 'Restoring interactive fixture' : rows.find(row => row.error)?.errorPhase,
      cancelled: stop,
      policy: TIMING_POLICY,
    })
    if (error) deviceFailed = true
    status.textContent = error
      ? `Sweep stopped: ${error instanceof Error ? error.message : String(error)}. Export results, then restart devices.`
      : `${stop ? 'Stopped' : 'Sweep complete'} · ${rows.filter(row => row.status === 'passed').length}/${plan.length} passed · export available`
  }
  disable(true)
  await Promise.all([['WebGL', createWebGLBackend], ['WebGPU', createWebGPUBackend]].map(async ([name, create]) => {
    try {
      const backend = await (create as typeof createWebGLBackend)(el<HTMLCanvasElement>(`[data-canvas="${name}"]`),
        () => el<HTMLSelectElement>('[data-control="spring-loop"]').value === 'early-exit')
      backends.push(backend)
      el<HTMLElement>(`[data-info="${name}"]`).textContent = backend.info
      el<HTMLElement>(`[data-status="${name}"]`).textContent = 'Ready'
    } catch (error) {
      el<HTMLElement>(`[data-status="${name}"]`).textContent = 'Unavailable'
      el<HTMLElement>(`[data-info="${name}"]`).textContent = error instanceof Error ? error.message : String(error)
    }
  }))
  backends.sort((a, b) => a.name.localeCompare(b.name))
  await task(configure)
  if (!backends.length) { status.textContent = 'No usable GPU backend.'; disable(true) }
  host.querySelectorAll('select,input').forEach(control => control.addEventListener('change', () => { changed = false; task(configure) }))
  el('[data-action="step"]').addEventListener('click', () => { task(async () => { await step() }) })
  el('[data-action="ten"]').addEventListener('click', () => {
    task(async () => {
      for (let i = 0; i < 10; i++) {
        if (cancelled() || !(await step())) break
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    })
  })
  el('[data-action="reset"]').addEventListener('click', () => { task(reset) })
  el('[data-action="topology"]').addEventListener('click', () => { changed = !changed; task(configure) })
  el('[data-action="benchmark"]').addEventListener('click', () => { task(benchmark) })
  el('[data-action="diagnose-render"]').addEventListener('click', () => { task(diagnoseRender) })
  el('[data-action="check-star"]').addEventListener('click', () => {
    task(async () => {
      el<HTMLSelectElement>('[data-control="spring-loop"]').value = 'original'
      el<HTMLSelectElement>('[data-control="sweep-backend"]').value = 'Both'
      el<HTMLSelectElement>('[data-control="sweep-shape"]').value = 'star'
      el<HTMLSelectElement>('[data-control="sweep-count"]').value = '100000'
      await sweep(true)
    })
  })
  el('[data-action="sweep-small"]').addEventListener('click', () => { task(async () => { await sweep(false) }) })
  el('[data-action="sweep-large"]').addEventListener('click', () => { task(async () => { await sweep(true) }) })
  el('[data-action="restart"]').addEventListener('click', () => { window.location.reload() })
  el('[data-action="stop"]').addEventListener('click', () => { stop = true; status.textContent = 'Stopping after current GPU operation…' })
  el('[data-action="export"]').addEventListener('click', () => {
    if (!capture) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...capture, gpuApi: 'luma-resources-v1' }, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'weighted-links-capture.json'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  return { destroy (): void { destroyed = true; if (!busy) cleanup(); host.replaceChildren() } }
}
