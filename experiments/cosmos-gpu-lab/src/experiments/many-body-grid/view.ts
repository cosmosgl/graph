import type { ExperimentInstance } from '../../runtime/experiment'
import { createFixture, PARAMETERS, type Fixture } from '../many-body/data'
import { fitView, type View } from '../many-body/backend'
import { compareArray, TOLERANCE, type Snapshot } from '../many-body/reference'
import { buildReference, frameFor, layout } from './data'
import { gridReference, comparePresent, approximationError, integrate } from './reference'
import { compareStructure } from './validation'
import { createGridWebGL } from './webgl'
import { createGridWebGPU } from './webgpu'
import type { GridBackend } from './backend'
function drawCpu (canvas: HTMLCanvasElement, points: Float32Array, view: View): void {
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#13161b'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < points.length; i += 4) {
    if (points[i + 3] > 0.5) continue
    ctx.fillStyle = points[i + 2] > 0.5 ? '#ffb866' : '#9fb5d5'
    ctx.beginPath()
    ctx.arc(((points[i] - view[0]) * view[2] + 1) * canvas.width / 2,
      (1 - (points[i + 1] - view[1]) * view[3]) * canvas.height / 2, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
}
export async function createGridExperiment (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `
    <p class="demo-note">Matched inputs: both GPUs build their own hierarchy and samples, using shared CPU bounds, shifts and seeds.
      Fixed sample budgets isolate the force port; automatic tuning and GPU bounds reduction are not validated here.</p>
    <div class="scale-toolbar">
      <label>Fixture <select data-control="fixture">
        ${['uniform', 'clusters', 'coincident', 'edge-cases', 'boundary'].map(x => `<option>${x}</option>`).join('')}</select></label>
      <label>Points <select data-control="count">
        ${[8, 65, 512, 4096, 8192, 16384].map(n => `<option ${n === 8192 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Samples per cell <select data-control="slots">
        ${[2, 8, 16, 32].map(n => `<option ${n === 8 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Far-field quality <select data-control="quality">
        <option value="precise">Precise · 5×5 shell</option>
        <option value="balanced">Balanced · 3×3 shell</option></select></label>
    </div>
    <div class="demo-toolbar playback-toolbar"><div class="controls"><button data-action="step" class="button-primary">Step + validate</button>
      <button data-action="three">3 validated ticks</button><button data-action="stop" disabled>Stop</button>
      <button data-action="reset">Reset / retry devices</button><button data-action="export" disabled>Export JSON</button>
      </div><span class="tick-counter">Tick <strong data-output="tick">0</strong></span></div>
    <p class="many-body-status" data-output="status" role="status">Preparing backends…</p>
    <p class="demo-note" data-output="grid"></p>
    <section class="backend-panels many-body-panels">${['WebGL', 'WebGPU', 'CPU'].map(name => `<article class="backend-panel">
      <div class="panel-heading"><h2>${name}</h2><span data-status="${name}" class="status">Starting…</span></div>
      <canvas data-canvas="${name}" width="480" height="340" aria-label="${name} hierarchical positions"></canvas>
      <p class="demo-note" data-info="${name}"></p></article>`).join('')}</section>
    <p class="demo-note">Each tick starts from CPU-model positions. Blue points are free, orange points pinned; absent points are hidden.
      GPU panels draw resident positions. Force-only motion expands the layout; springs, gravity and cooling are disabled.</p>
    <div class="many-body-results" data-output="results"></div>
    <div class="many-body-results" data-output="approximation"></div>
    <p class="demo-note">Port checks use every present target and every cell/slot. Approximation error uses up to 64 evenly spaced target indices,
      each evaluated against every source. This is a diagnostic subset, not a whole-layout accuracy guarantee or a GPU timing benchmark.</p>
  `
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const fixture = el<HTMLSelectElement>('[data-control="fixture"]'); const count = el<HTMLSelectElement>('[data-control="count"]')
  const slots = el<HTMLSelectElement>('[data-control="slots"]'); const quality = el<HTMLSelectElement>('[data-control="quality"]')
  const canvas = (name: string): HTMLCanvasElement => el(`[data-canvas="${name}"]`)
  const status = el('[data-output="status"]')
  let input = createFixture('uniform', 8192); let cpu = input.points; let tick = 0; let busy = false; let stopped = false; let destroyed = false
  const lanes: Array<{ name: string; backend: GridBackend; positions: Float32Array }> = []
  const errors: Record<string, string> = {}; const rows: Array<Record<string, unknown>> = []
  const controls = (): void => {
    host.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(c => { c.disabled = busy })
    el<HTMLButtonElement>('[data-action="stop"]').disabled = !busy
    el<HTMLButtonElement>('[data-action="export"]').disabled = busy || !rows.length
    count.disabled = busy || ['edge-cases', 'boundary'].includes(fixture.value)
  }
  const cleanup = (): void => { lanes.splice(0).forEach(l => l.backend.destroy()) }
  const render = (): void => {
    const view = fitView([cpu, ...lanes.map(l => l.positions)])
    for (const lane of lanes) {
      if (errors[lane.name]) continue
      try { lane.backend.render(view) } catch (error) {
        errors[lane.name] = error instanceof Error ? error.message : String(error)
        el(`[data-status="${lane.name}"]`).textContent = 'Failed'
        el(`[data-info="${lane.name}"]`).textContent = errors[lane.name]
      }
    }
    drawCpu(canvas('CPU'), cpu, view)
  }
  const setup = async (): Promise<void> => {
    cleanup(); rows.length = 0; tick = 0
    Object.keys(errors).forEach(key => { delete errors[key] })
    input = createFixture(fixture.value as Fixture, Number(count.value)); cpu = input.points
    count.value = String(cpu.length / 4)
    const frame = frameFor(cpu, 0, Number(slots.value), quality.value === 'precise')
    el('[data-output="tick"]').textContent = '0'; el('[data-output="results"]').replaceChildren(); el('[data-output="approximation"]').replaceChildren()
    const l = layout(cpu.length / 4)
    el('[data-output="grid"]').textContent = `${cpu.length / 4} points · ${l.sizes.join(' → ')} cells per axis · ${frame.slots} slots/cell · ` +
      'new shared shift and seed each tick. Bounds and CPU reference are computed outside GPU execution.'
    status.textContent = 'Preparing backends…'
    for (const name of ['WebGL', 'WebGPU']) {
      const old = canvas(name); const fresh = old.cloneNode() as HTMLCanvasElement; old.replaceWith(fresh)
      el(`[data-status="${name}"]`).textContent = 'Starting…'
      try {
        const backend = await (name === 'WebGL' ? createGridWebGL : createGridWebGPU)(fresh, input, PARAMETERS, frame)
        if (destroyed) { backend.destroy(); return }
        lanes.push({ name, backend, positions: cpu })
        el(`[data-status="${name}"]`).textContent = 'Ready'
        el(`[data-info="${name}"]`).textContent = backend.info
      } catch (error) {
        errors[name] = error instanceof Error ? error.message : String(error)
        el(`[data-status="${name}"]`).textContent = 'Unavailable'; el(`[data-info="${name}"]`).textContent = errors[name]
      }
      if (destroyed) return
    }
    el('[data-status="CPU"]').textContent = 'Ready'
    el('[data-info="CPU"]').textContent = 'Float32 hierarchy and weighted-neighbor reference; Canvas 2D preview.'
    render()
    status.textContent = lanes.length === 2 && !Object.keys(errors).length
      ? 'Ready. Step to validate independently built grids and forces.'
      : 'Partial comparison: a GPU backend is unavailable.'
  }
  const step = async (): Promise<boolean> => {
    status.textContent = `Validating tick ${tick + 1}…`
    await new Promise(resolve => setTimeout(resolve, 0))
    const previous = cpu; const frame = frameFor(previous, tick, Number(slots.value), quality.value === 'precise')
    const structure = buildReference(previous, frame)
    const expected = gridReference(input, previous, PARAMETERS, frame, structure)
    const checks: Array<{
      name: string; structure: ReturnType<typeof compareStructure>; output: ReturnType<typeof comparePresent>;
      local: ReturnType<typeof comparePresent>; integration: ReturnType<typeof compareArray>;
    }> = []
    const snapshots: Record<string, Snapshot> = {}
    for (const lane of lanes) {
      if (destroyed) return false
      if (errors[lane.name]) continue
      try {
        lane.backend.setPositions(previous); lane.backend.setFrame(frame); lane.backend.step()
        const actual = await lane.backend.read(); const actualStructure = await lane.backend.readStructure()
        if (destroyed) return false
        const check = {
          name: lane.name,
          structure: compareStructure(actualStructure, structure),
          output: comparePresent(actual, expected, previous),
          integration: compareArray(actual.positions, integrate(previous, actual.forces, PARAMETERS), previous),
          local: comparePresent(actual, gridReference(input, previous, PARAMETERS, frame, actualStructure), previous),
        }
        checks.push(check); snapshots[lane.name] = actual; lane.positions = actual.positions
        const valid = check.structure.valid && check.output.valid && check.local.valid && check.integration.valid
        el(`[data-status="${lane.name}"]`).textContent = valid ? 'Passed' : 'Mismatch'
      } catch (error) {
        errors[lane.name] = error instanceof Error ? error.message : String(error)
        el(`[data-status="${lane.name}"]`).textContent = 'Failed'; el(`[data-info="${lane.name}"]`).textContent = errors[lane.name]
      }
    }
    if (destroyed) return false
    const approximation = approximationError(input, previous, expected.forces, PARAMETERS, frame)
    const cross = snapshots.WebGL && snapshots.WebGPU ? comparePresent(snapshots.WebGPU, snapshots.WebGL, previous) : null
    cpu = expected.positions; render()
    const passed = Boolean(cross?.valid) && checks.length === 2 && Object.keys(errors).length === 0 &&
      checks.every(c => c.structure.valid && c.output.valid && c.local.valid && c.integration.valid)
    tick++; el('[data-output="tick"]').textContent = String(tick)
    rows.push({
      tick,
      bounds: Array.from(frame.bounds),
      seed: frame.seed,
      slots: frame.slots,
      precise: frame.precise,
      checks,
      cross,
      approximation,
      passed,
      errors: { ...errors },
    })
    const num = (n: number): string => Number.isFinite(n) ? n.toExponential(2) : 'non-finite'
    const crossLabel = cross
      ? `forces ${cross.forces.valid ? 'Pass' : 'FAIL'} (${num(cross.forces.maxError)} max); ` +
        `positions ${cross.positions.valid ? 'Pass' : 'FAIL'} (${num(cross.positions.maxError)} max).`
      : 'Unavailable.'
    el('[data-output="results"]').innerHTML = `<table><caption>Tick ${tick} · port checks against CPU</caption>
      <thead><tr><th>Backend</th><th>Aggregate components</th><th>Slot IDs</th><th>Force max error</th><th>Position max error</th>
      <th>Same-structure output</th><th>Integration from GPU force</th></tr></thead>
      <tbody>${checks.map(c => `<tr><td>${c.name}</td><td>${c.structure.aggregates.valid ? 'Pass' : `${c.structure.aggregates.failures} fail`}</td>
        <td>${c.structure.slotMismatches ? `${c.structure.slotMismatches} differ` : 'Exact'}
          ${c.structure.maxHashError > 2e-7 ? `· hash FAIL (${num(c.structure.maxHashError)})` : ''}</td>
        <td>${num(c.output.forces.maxError)} · ${c.output.forces.valid ? 'Pass' : 'FAIL'}</td>
        <td>${num(c.output.positions.maxError)} · ${c.output.positions.valid ? 'Pass' : 'FAIL'}</td>
        <td>${c.local.valid ? 'Pass' : 'FAIL'}</td><td>${c.integration.valid ? 'Pass' : 'FAIL'}</td></tr>`).join('')}</tbody></table>
      <p class="demo-note">WebGPU vs production WebGL: ${crossLabel}
      Integration uses each GPU’s own force readback to isolate the position update; it does not replace the full comparison above.</p>`
    el('[data-output="approximation"]').innerHTML = `<table><caption>CPU approximation · relative L2 force error on ${approximation.targets} targets
      · not a port pass/fail</caption>
      <thead><tr><th>Reference</th><th>Error</th></tr></thead><tbody>
      <tr><td>Production exact radius split</td><td>${num(approximation.versusProductionExactPercent)}%</td></tr>
      <tr><td>Exact pairs with the same grid near/far partition</td><td>${num(approximation.versusExactGridPartitionPercent)}%</td></tr></tbody></table>`
    el('[data-status="CPU"]').textContent = 'Computed'
    const verdict = passed ? 'Passed' : checks.length < 2 ? 'Partial comparison' : 'Mismatch'
    status.textContent = `${verdict} · tick ${tick}. Approximation error is reported separately.`
    return passed
  }
  const task = async (work: () => Promise<void>): Promise<void> => {
    if (busy || destroyed) return
    busy = true; stopped = false; controls()
    try { await work() } catch (error) {
      if (!destroyed) status.textContent = error instanceof Error ? error.message : String(error)
    } finally { busy = false; if (!destroyed) controls() }
  }
  for (const control of [fixture, count, slots, quality]) control.addEventListener('change', () => { task(setup) })
  el('[data-action="step"]').addEventListener('click', () => { task(async () => { await step() }) })
  el('[data-action="three"]').addEventListener('click', () => {
    task(async () => {
      for (let i = 0; i < 3; i++) { if (stopped || destroyed || !await step()) break; await new Promise(resolve => setTimeout(resolve, 0)) }
      if (stopped && !destroyed) status.textContent = `Stopped at tick ${tick}; completed results can be exported.`
    })
  })
  el('[data-action="stop"]').addEventListener('click', () => { stopped = true })
  el('[data-action="reset"]').addEventListener('click', () => { task(setup) })
  el('[data-action="export"]').addEventListener('click', () => {
    const capture = {
      schemaVersion: 1,
      experiment: 'many-body-grid',
      recordedAt: new Date().toISOString(),
      browser: navigator.userAgent,
      fixture: fixture.value,
      count: input.points.length / 4,
      parameters: PARAMETERS,
      tolerance: TOLERANCE,
      devices: Object.fromEntries(lanes.map(l => [l.name, l.backend.info])),
      rows,
      errors,
    }
    const serialized = JSON.stringify(capture, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)
    const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'cosmos-many-body-grid.json'; a.click(); URL.revokeObjectURL(url)
  })
  await task(setup)
  return { destroy (): void { destroyed = true; stopped = true; cleanup() } }
}
