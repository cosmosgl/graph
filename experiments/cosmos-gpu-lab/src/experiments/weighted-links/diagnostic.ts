import type { ExperimentInstance } from '../../runtime/experiment'
import { SIMULATION_PASSES, type LinkBackend, type WebGLCheckpoint } from './backend'
import { buildTopology, PARAMETERS } from './data'
import { compare, compareArray, referenceTick, TOLERANCE, type Snapshot } from './reference'
import { createSweepGraph, validateTrajectory, type ValidationCheck } from './sweep'
import { createWebGLBackend } from './webgl'
import { createWebGPUBackend } from './webgpu'

const LABELS = ['Source spring', 'Source integration', 'Target spring', 'Target integration']
const STORAGE_KEY = 'cosmos-weighted-links-pass-diagnostic'

// Intentionally creates one device. A paired demo with one backend filtered from its sweep
// still owns the other device, so it cannot provide the same isolation.
export async function createPassDiagnostic (host: HTMLElement, name: 'WebGL' | 'WebGPU'): Promise<ExperimentInstance> {
  host.innerHTML = `<section class="scale-toolbar">
    <h2>${name} · isolated simulation passes</h2>
    <p>One device, no rendering or timer queries. Run one pass at a time; each complete output is read back
      and compared with the independent CPU reference. Completion times include readback and are not GPU benchmarks.</p>
    <p><a href="?linkDiagnostic=WebGL#/weighted-links">WebGL only</a> ·
      <a href="?linkDiagnostic=WebGPU#/weighted-links">WebGPU only</a> · <a href="?#/weighted-links">Paired demo</a></p>
    <label>Star points <select data-count>${[1000, 10000, 50000, 100000].map(n => `<option>${n}</option>`).join('')}</select></label>
    ${name === 'WebGL'
    ? `<label>Spring loop <select data-loop><option value="original">Cosmos directional bounds</option>
      <option value="early-exit">Stop at point degree</option></select></label>`
    : ''}
    ${name === 'WebGL'
    ? `<label>Trajectory synchronization <select data-sync>
      <option value="fence">GPU fence</option><option value="pixel">One-pixel read (baseline)</option></select></label>`
    : ''}
    <div class="controls"><button data-prepare disabled>Prepare star</button><button data-next disabled>Run source spring</button>
      <button data-grouped disabled>Run one grouped tick</button>
      <button data-trajectory disabled>Validate 25 ticks</button><button data-export disabled>Export JSON</button></div>
    <p>Start small. A 100k star has caused native device loss. On failure, this diagnostic stops without retrying.
      The last checkpoint is kept in this browser so it survives a page reload.</p>
    <p role="status" data-status>Creating ${name} only…</p><p data-device></p>
    <div class="markdown-body" data-results></div>
    <details><summary>Last saved diagnostic</summary><pre data-saved></pre></details>
    <canvas width="480" height="340" hidden></canvas>
  </section>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const saved = el('[data-saved]'); const results = el('[data-results]')
  const status = el('[data-status]'); const prepare = el<HTMLButtonElement>('[data-prepare]')
  const next = el<HTMLButtonElement>('[data-next]'); const count = el<HTMLSelectElement>('[data-count]')
  const loop = host.querySelector<HTMLSelectElement>('[data-loop]')
  const trajectory = el<HTMLButtonElement>('[data-trajectory]')
  const sync = host.querySelector<HTMLSelectElement>('[data-sync]')
  const grouped = el<HTMLButtonElement>('[data-grouped]')
  const exportButton = el<HTMLButtonElement>('[data-export]')
  let backend: LinkBackend | undefined; let destroyed = false; let busy = false; let failed = false
  let expected: Snapshot | undefined; let index = 0
  const rows: Array<Record<string, unknown>> = []
  const checkpoints: WebGLCheckpoint[] = []
  let capture: Record<string, unknown> | undefined
  let storageWarning = ''
  try { saved.textContent = localStorage.getItem(STORAGE_KEY) || 'No saved diagnostic.' } catch {
    storageWarning = 'Browser checkpoint storage unavailable.'
  }
  const save = (): void => {
    if (!capture) return
    const json = JSON.stringify(capture, null, 2)
    try { localStorage.setItem(STORAGE_KEY, json) } catch { storageWarning = 'Browser checkpoint storage unavailable; export JSON to retain this run.' }
    saved.textContent = json
    exportButton.disabled = false
  }
  const controls = (): void => {
    prepare.disabled = busy || failed || !backend
    trajectory.disabled = busy || failed || !expected
    grouped.disabled = busy || failed || !expected
    next.disabled = busy || failed || !expected || index >= SIMULATION_PASSES.length
    count.disabled = busy || failed
    if (loop) loop.disabled = busy || failed
    if (sync) sync.disabled = busy || failed
    next.textContent = index < LABELS.length ? `Run ${LABELS[index].toLowerCase()}` : 'All four passes complete'
  }
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy || destroyed || failed) return
    busy = true; controls()
    try { await action() } catch (error) {
      failed = true
      const message = error instanceof Error ? error.message : String(error)
      if (capture) { capture.error = message; capture.status = 'error'; save() }
      status.textContent = `Stopped: ${message}. No later pass was submitted.`
    } finally {
      busy = false
      if (destroyed) backend?.destroy(); else controls()
    }
  }
  const invalidate = (): void => { expected = undefined; index = 0; controls(); status.textContent = 'Prepare the selected star before running passes.' }
  count.addEventListener('change', invalidate); loop?.addEventListener('change', invalidate); sync?.addEventListener('change', invalidate)
  prepare.addEventListener('click', () => {
    run(async () => {
      expected = undefined; index = 0; rows.length = 0; checkpoints.length = 0; results.replaceChildren()
      capture = {
        experiment: 'weighted-links',
        mode: 'isolated-passes',
        capturedAt: new Date().toISOString(),
        browser: navigator.userAgent,
        luma: '10.0.0-alpha.4',
        backend: name,
        device: backend!.info,
        count: Number(count.value),
        fixture: 'star',
        webglSpringLoop: loop?.value,
        synchronization: sync?.value ?? 'queue',
        parameters: PARAMETERS,
        tolerance: TOLERANCE,
        status: 'running',
        phase: 'setup',
        passes: rows,
        checkpoints,
      }
      status.textContent = 'Preparing resources and the independent CPU reference…'; save()
      // Paint and persist the checkpoint before any expensive GPU operation.
      await new Promise(resolve => setTimeout(resolve, 0))
      if (destroyed) return
      const graph = createSweepGraph({ count: Number(count.value), shape: 'star' })
      const topology = buildTopology(graph)
      capture.links = topology.links.length / 2; capture.maxDegree = topology.maxDegree
      capture.directionalMaxDegrees = topology.directions.map(direction => direction.maxDegree)
      backend!.setGraph(graph, topology, PARAMETERS); await backend!.synchronize()
      if (destroyed) return
      expected = referenceTick(graph, graph.points, PARAMETERS)
      capture.status = 'ready'; save()
      status.textContent = `Prepared ${count.value} points. No simulation pass has run. ${storageWarning}`
    })
  })
  next.addEventListener('click', () => {
    run(async () => {
      if (!expected || index >= SIMULATION_PASSES.length) return
      const pass = SIMULATION_PASSES[index]; const label = LABELS[index]
      capture!.phase = pass; capture!.status = 'running'; save()
      status.textContent = `${label}: submitting and reading the full output…`
      await new Promise(resolve => setTimeout(resolve, 0))
      if (destroyed) return
      const started = performance.now()
      const data = await backend!.diagnosePass!(pass)
      if (destroyed) return
      const completionMs = performance.now() - started
      const check = compareArray(data, expected[pass])
      rows.push({ pass, completionMs, ...check })
      results.innerHTML = `<table><thead><tr><th>Pass</th><th>Result</th><th>Failures</th>
        <th>Max error</th><th>Completion + readback ms</th></tr></thead><tbody>${rows.map((row, i) =>
    `<tr><td>${LABELS[i]}</td><td>${row.valid ? 'PASS' : 'FAIL'}</td><td>${row.failures}</td>
          <td>${Number(row.maxError).toExponential(3)}</td><td>${Number(row.completionMs).toFixed(3)}</td></tr>`).join('')}</tbody></table>`
      if (!check.valid) failed = true
      index++
      capture!.status = failed ? 'failed' : index === SIMULATION_PASSES.length ? 'passed' : 'ready'; save()
      status.textContent = failed
        ? `${label} failed validation. No later pass was submitted.`
        : `${label} passed. ${index === SIMULATION_PASSES.length ? 'One full tick validated.' : 'The next pass has not run.'} ${storageWarning}`
    })
  })
  grouped.addEventListener('click', () => {
    run(async () => {
      if (!expected) return
      delete capture!.groupedTick; delete capture!.trajectory; delete capture!.error
      capture!.runStartedAt = new Date().toISOString(); checkpoints.length = 0
      capture!.phase = 'grouped tick'; capture!.status = 'running'; save()
      status.textContent = 'Submitting four simulation passes together; no rendering or timer queries…'
      await new Promise(resolve => setTimeout(resolve, 0))
      if (destroyed) return
      backend!.reset()
      const started = performance.now()
      backend!.step(false)
      const actual = await backend!.read()
      if (destroyed) return
      const completionMs = performance.now() - started
      const check = compare(actual, expected)
      capture!.groupedTick = { completionMs, ...check }
      capture!.status = check.valid ? 'passed' : 'failed'
      failed = !check.valid
      // This run started from the initial positions and consumed all four passes.
      index = SIMULATION_PASSES.length; save()
      status.textContent = `Grouped tick ${check.valid ? 'PASS' : 'FAIL'} · ${check.failures} failures · max error ${check.maxError.toExponential(3)}.`
    })
  })
  trajectory.addEventListener('click', () => {
    run(async () => {
      if (!expected) return
      const graph = createSweepGraph({ count: Number(count.value), shape: 'star' })
      delete capture!.groupedTick; delete capture!.error
      const checks: ValidationCheck[] = []
      capture!.trajectory = checks; capture!.runStartedAt = new Date().toISOString(); checkpoints.length = 0
      capture!.status = 'running'; capture!.phase = 'trajectory'; save()
      await validateTrajectory([backend!], graph, PARAMETERS, () => destroyed, text => {
        capture!.phase = text; save(); status.textContent = text
      }, undefined, checks)
      if (destroyed) return
      failed = checks.some(check => !check.valid)
      capture!.trajectory = checks; capture!.status = failed ? 'failed' : 'passed'
      index = SIMULATION_PASSES.length; save()
      status.textContent = `25-tick trajectory ${failed ? 'FAIL' : 'PASS'} · snapshots at 1, 10, 25 · no rendering or timer queries.`
    })
  })
  exportButton.addEventListener('click', () => {
    if (!capture) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(capture, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `weighted-links-${name.toLowerCase()}-passes.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  try {
    const canvas = el<HTMLCanvasElement>('canvas')
    backend = name === 'WebGL'
      ? await createWebGLBackend(canvas, () => loop?.value === 'early-exit', () => sync?.value === 'fence' ? 'fence' : 'pixel', entry => {
        if (destroyed || !capture) return
        checkpoints.push(entry)
        if (checkpoints.length > 1024) checkpoints.shift()
        if (entry.contextLost) {
          failed = true; capture.status = 'error'; capture.deviceLoss ??= entry
          status.textContent = `Context loss observed: ${entry.phase}`
          controls()
        }
        save()
      })
      : await createWebGPUBackend(canvas)
    el('[data-device]').textContent = backend.info
    status.textContent = `${name} ready. Prepare a star to begin.`
  } catch (error) {
    failed = true; status.textContent = `GPU unavailable: ${error instanceof Error ? error.message : String(error)}`
  }
  controls()
  return { destroy (): void { destroyed = true; if (!busy) backend?.destroy(); host.replaceChildren() } }
}
