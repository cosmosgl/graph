import type { ExperimentInstance } from '../../runtime/experiment'
import { fitView, type Backend, type View } from './backend'
import { createFixture, FIXTURES, nearLimit, PARAMETERS, type Fixture, type Variant } from './data'
import { compare, referenceTick, TOLERANCE, type Snapshot } from './reference'
import { createWebGL } from './webgl'
import { createWebGPU } from './webgpu'

function drawCpu (canvas: HTMLCanvasElement, positions: Float32Array, view: View): void {
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = 'rgb(19,22,27)'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  for (let i = 0; i < positions.length; i += 4) {
    if (positions[i + 3] > 0.5) continue
    const x = ((positions[i] - view[0]) * view[2] + 1) * canvas.width / 2
    const y = (1 - (positions[i + 1] - view[1]) * view[3]) * canvas.height / 2
    ctx.fillStyle = positions[i + 2] > 0.5 ? '#ffb866' : '#9fb5d5'
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill()
  }
}

export async function createManyBodyExperiment (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `
    <section class="scale-toolbar">
      <label>Fixture <select data-control="fixture">
        ${FIXTURES.map(value => `<option ${value === 'uniform' ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
      <label>Points <select data-control="count">
        ${[2, 8, 32, 65, 128, 512, 1024, 4096].map(n => `<option ${n === 128 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>WebGPU loop <select data-control="variant"><option value="direct">Ordered direct</option>
        <option value="tiled">Shared-memory tiles · 64</option></select></label>
      <label>Comparison <select data-control="mode"><option value="matched">Same input each tick</option>
        <option value="trajectory">Independent trajectories</option></select></label>
    </section>
    <div class="demo-toolbar playback-toolbar"><div class="controls">
      <button class="button-primary" data-action="step">Step + validate</button>
      <button data-action="ten">10 validated ticks</button><button data-action="stop" disabled>Stop</button>
      <button data-action="reset">Reset / retry devices</button><button data-action="export" disabled>Export JSON</button>
    </div><span class="tick-counter">Tick <strong data-output="tick">0</strong></span></div>
    <p class="many-body-status" data-output="status" role="status">Creating GPU backends…</p>
    <p class="demo-note" data-output="mode"></p>
    <section class="backend-panels many-body-panels">
      ${['WebGL', 'WebGPU', 'CPU'].map(name => `<article class="backend-panel">
        <div class="panel-heading"><div><p class="eyebrow">
          ${name === 'WebGL' ? 'Production GLSL · luma v10' : name === 'WebGPU' ? 'luma Kernel + RenderKernel' : 'Float32 operation reference'}</p>
        <h2>${name}</h2></div><span class="status" data-status="${name}">Starting…</span></div>
        <canvas data-canvas="${name}" width="480" height="340" aria-label="${name} point positions"></canvas>
        <p class="demo-note" data-info="${name}"></p>
      </article>`).join('')}
    </section>
    <p class="demo-note">Identical initial positions, fixed random samples and parameters.
      Blue points are free; orange points are pinned; absent points are hidden.
      The camera fits all three outputs together. This force-only layout expands; gravity, springs and cooling are not enabled.</p>
    <div class="many-body-results" data-output="results"></div>
    <details class="advanced-controls"><summary>Validation contract and parameters</summary>
      <p class="demo-note" data-output="parameters"></p>
      <p class="demo-note">Every validation tick reads back forces and positions. This is a correctness comparison, not a GPU performance benchmark.
      Reported elapsed time includes CPU calculation, GPU work, readback and drawing submission. An unavailable or failed backend never counts as a pass.</p>
    </details>
  `
  const el = <T extends HTMLElement>(selector: string): T => {
    const found = host.querySelector<T>(selector)
    if (!found) throw new Error(`Missing ${selector}`)
    return found
  }
  const fixture = el<HTMLSelectElement>('[data-control="fixture"]')
  const count = el<HTMLSelectElement>('[data-control="count"]')
  const variant = el<HTMLSelectElement>('[data-control="variant"]')
  const mode = el<HTMLSelectElement>('[data-control="mode"]')
  const status = el<HTMLElement>('[data-output="status"]')
  const params = { ...PARAMETERS }
  let input = createFixture('uniform', 128)
  let cpu: Float32Array = input.points.slice(); let tick = 0; let busy = false; let stopped = false; let destroyed = false
  type Lane = { key: 'WebGL' | 'WebGPU'; backend: Backend; previous: Float32Array; failed: boolean }
  const lanes: Lane[] = []
  const rows: Array<Record<string, unknown>> = []
  const errors: Record<string, string> = {}
  const info: Record<string, string> = {}
  const canvas = (name: string): HTMLCanvasElement => el(`[data-canvas="${name}"]`)
  const controls = (running: boolean): void => {
    host.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(control => { control.disabled = running })
    el<HTMLButtonElement>('[data-action="stop"]').disabled = !running
    el<HTMLButtonElement>('[data-action="export"]').disabled = running || (rows.length === 0 && Object.keys(errors).length === 0)
    count.disabled = running || ['pair', 'edge-cases', 'boundary'].includes(fixture.value)
  }
  const cleanup = (): void => { lanes.splice(0).forEach(lane => lane.backend.destroy()) }
  const render = (): void => {
    const view = fitView([cpu, ...lanes.filter(lane => !lane.failed).map(lane => lane.previous)])
    for (const lane of lanes) {
      if (lane.failed) continue
      try { lane.backend.render(view) } catch (error) { fail(lane, error) }
    }
    drawCpu(canvas('CPU'), cpu, view)
  }
  const fail = (lane: Lane, error: unknown): void => {
    lane.failed = true
    errors[lane.key] = error instanceof Error ? error.message : String(error)
    el(`[data-status="${lane.key}"]`).textContent = 'Failed'
    el(`[data-info="${lane.key}"]`).textContent = errors[lane.key]
  }
  const setup = async (): Promise<void> => {
    cleanup(); rows.length = 0; tick = 0
    Object.keys(errors).forEach(key => { delete errors[key] }); Object.keys(info).forEach(key => { delete info[key] })
    input = createFixture(fixture.value as Fixture, Number(count.value), params); cpu = input.points.slice()
    count.value = String(cpu.length / 4)
    el('[data-output="tick"]').textContent = '0'; el('[data-output="results"]').replaceChildren()
    el('[data-output="parameters"]').textContent = `N = ${cpu.length / 4}; alpha ${params.alpha}; repulsion ${params.repulsion}; ` +
      `friction ${params.friction}; ` +
      `near radius / near kick cap ${nearLimit(cpu.length / 4, params)}; integration guard ${params.referenceLength}. ` +
      `Tolerance: ${TOLERANCE.absolute} + ${TOLERANCE.relative} × |reference|. Flags must match exactly.`
    el('[data-output="mode"]').textContent = mode.value === 'matched'
      ? 'Same-input mode: both GPUs start each tick from the CPU positions. This isolates force and integration accuracy; it does not measure trajectory drift.'
      : 'Trajectory mode: each backend evolves independently. CPU checks use each backend’s own previous positions. Drift compares independent paths.'
    status.textContent = 'Creating GPU backends…'
    for (const key of ['WebGL', 'WebGPU'] as const) {
      // A canvas cannot switch to another device context: replace it when recreating devices.
      const old = canvas(key); const fresh = old.cloneNode() as HTMLCanvasElement; old.replaceWith(fresh)
      el(`[data-status="${key}"]`).textContent = 'Starting…'; el(`[data-info="${key}"]`).textContent = ''
      try {
        const backend = key === 'WebGL' ? await createWebGL(fresh, input, params) : await createWebGPU(fresh, input, params, variant.value as Variant)
        if (destroyed) { backend.destroy(); return }
        lanes.push({ key, backend, previous: input.points.slice(), failed: false })
        info[key] = backend.info
        el(`[data-status="${key}"]`).textContent = 'Ready'; el(`[data-info="${key}"]`).textContent = backend.info
      } catch (error) {
        errors[key] = error instanceof Error ? error.message : String(error)
        el(`[data-status="${key}"]`).textContent = 'Unavailable'; el(`[data-info="${key}"]`).textContent = errors[key]
      }
      if (destroyed) return
    }
    el('[data-status="CPU"]').textContent = 'Ready'
    el('[data-info="CPU"]').textContent = 'Independent scalar force + integration; Math.fround arithmetic. Canvas 2D preview.'
    render()
    status.textContent = Object.keys(errors).length
      ? 'Partial comparison: a GPU backend is unavailable. Available lanes and CPU still work.'
      : 'Ready. Choose Step + validate to compare the first tick.'
  }
  const step = async (): Promise<boolean> => {
    status.textContent = `Validating tick ${tick + 1}…`
    const started = performance.now()
    const previousCpu = cpu
    const expected = referenceTick(input, previousCpu, params)
    const outputs = new Map<string, Snapshot>()
    const checks: Array<{ name: string; result: ReturnType<typeof compare>; drift: ReturnType<typeof compare> }> = []
    for (const lane of lanes) {
      if (lane.failed || destroyed) continue
      try {
        const matched = mode.value === 'matched'
        if (matched) lane.backend.setPositions(previousCpu)
        const local = matched ? expected : referenceTick(input, lane.previous, params)
        lane.backend.step()
        const actual = await lane.backend.read()
        if (destroyed) return false
        const result = compare(actual, local); const drift = compare(actual, expected)
        checks.push({ name: lane.key, result, drift }); outputs.set(lane.key, actual)
        lane.previous = actual.positions
        el(`[data-status="${lane.key}"]`).textContent = result.valid ? 'One-step pass' : 'Mismatch'
      } catch (error) { fail(lane, error) }
    }
    if (destroyed) return false
    tick++; cpu = expected.positions; el('[data-output="tick"]').textContent = String(tick)
    const cross = outputs.has('WebGL') && outputs.has('WebGPU') ? compare(outputs.get('WebGPU')!, outputs.get('WebGL')!) : null
    render()
    const passed = checks.length === 2 && checks.every(check => check.result.valid) && Object.keys(errors).length === 0 &&
      (mode.value !== 'matched' || cross?.valid === true)
    el('[data-status="CPU"]').textContent = 'Computed'
    const elapsedMs = performance.now() - started
    rows.push({ tick, checks, webgpuVsWebgl: cross, fullComparisonPassed: passed, elapsedMs, errors: { ...errors } })
    const verdict = (check: ReturnType<typeof compare>): string => check.valid
      ? 'Pass'
      : `Fail (${check.forces.failures + check.positions.failures} components)`
    const number = (value: number): string => Number.isFinite(value) ? value.toExponential(2) : 'non-finite'
    el('[data-output="results"]').innerHTML = `<table><caption>Tick ${tick} · maximum absolute component error</caption>
      <thead><tr><th>Comparison</th><th>Force</th><th>Position</th><th>Result</th></tr></thead><tbody>
      ${checks.map(check => `<tr><td>${check.name} vs CPU, same input</td><td>${number(check.result.forces.maxError)}</td>
        <td>${number(check.result.positions.maxError)}</td><td>${verdict(check.result)}</td></tr>`).join('')}
      ${cross
    ? `<tr><td>WebGPU vs WebGL${mode.value === 'trajectory' ? ' · independent paths' : ''}</td><td>${number(cross.forces.maxError)}</td>
        <td>${number(cross.positions.maxError)}</td><td>${mode.value === 'trajectory' ? 'Drift only' : cross.valid ? 'Pass' : 'Fail'}</td></tr>`
    : ''}
      ${mode.value === 'trajectory'
    ? checks.map(check => `<tr><td>${check.name} vs independent CPU path</td><td>${number(check.drift.forces.maxError)}</td>
        <td>${number(check.drift.positions.maxError)}</td><td>Drift only</td></tr>`).join('')
    : ''}</tbody></table>`
    const allAvailableChecksPass = checks.every(check => check.result.valid)
    const outcome = passed ? 'Passed' : checks.length < 2 ? 'Partial comparison' : 'Mismatch'
    status.textContent = `${outcome} · tick ${tick} · ${elapsedMs.toFixed(1)} ms validation elapsed (not GPU timing).${
      mode.value === 'trajectory' ? ' Independent-path drift is reported separately; no trajectory-quality verdict.' : ''}`
    return allAvailableChecksPass && (mode.value !== 'matched' || !cross || cross.valid) && Object.keys(errors).length === 0
  }
  const task = async (run: () => Promise<void>): Promise<void> => {
    if (busy || destroyed) return
    busy = true; stopped = false; controls(true)
    try { await run() } catch (error) {
      if (!destroyed) status.textContent = error instanceof Error ? error.message : String(error)
    } finally { busy = false; if (!destroyed) controls(false) }
  }
  for (const control of [fixture, count, variant, mode]) control.addEventListener('change', () => { task(setup) })
  el('[data-action="step"]').addEventListener('click', () => { task(async () => { await step() }) })
  el('[data-action="ten"]').addEventListener('click', () => {
    task(async () => {
      for (let i = 0; i < 10; i++) {
        if (stopped || destroyed) break
        if (!await step()) break
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      if (stopped && !destroyed) status.textContent = `Stopped at tick ${tick}. Completed results can be exported.`
    })
  })
  el('[data-action="stop"]').addEventListener('click', () => { stopped = true })
  el('[data-action="reset"]').addEventListener('click', () => { task(setup) })
  el('[data-action="export"]').addEventListener('click', () => {
    const capture = {
      schemaVersion: 1,
      experiment: 'many-body',
      recordedAt: new Date().toISOString(),
      browser: navigator.userAgent,
      fixture: fixture.value,
      count: input.points.length / 4,
      variant: variant.value,
      mode: mode.value,
      params,
      nearLimit: nearLimit(input.points.length / 4, params),
      tolerance: TOLERANCE,
      devices: info,
      errors,
      rows,
    }
    const serialized = JSON.stringify(capture, (_key, value) =>
      typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)
    const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'cosmos-many-body.json'; link.click(); URL.revokeObjectURL(url)
  })
  await task(setup)
  return { destroy (): void { destroyed = true; stopped = true; cleanup() } }
}
