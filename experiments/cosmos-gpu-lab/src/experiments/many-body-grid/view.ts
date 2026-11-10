import type { ExperimentInstance } from '../../runtime/experiment'
import { createFixture, PARAMETERS, type Fixture } from '../many-body/data'
import { fitView, type View } from '../many-body/backend'
import { compareArray, TOLERANCE, type Snapshot } from '../many-body/reference'
import { runPrecisionSweep, MODE_LABELS, type PrecisionTimingRow } from './benchmark'
import { compareCentroidPass } from './centroid-comparison'
import { diagnose } from './diagnostic'
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
      <button data-action="centroids">Compare centroid pass</button><button data-action="trace">Trace next tick</button>
      <button data-action="three">3 validated ticks</button><button data-action="benchmark">Benchmark precision</button>
      <button data-action="stop" disabled>Stop</button>
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
    <div class="many-body-results precision-trace" data-output="centroids"></div>
    <div class="many-body-results precision-trace" data-output="trace"></div>
    <section class="many-body-results precision-trace" data-output="timing" aria-label="Precision performance comparison">
      <p class="demo-note">Benchmark precision compares inline, stored and streamed contributions at 8,192 and 16,384 points,
        uniform and clustered. Batched GPU timestamps cover grid construction + force, and complete steps. Rendering is excluded.
        Stop keeps partial results; Export JSON includes timings and validation.</p></section>
    <p class="demo-note">Port checks use every present target and every cell/slot. Approximation error uses up to 64 evenly spaced target indices,
      each evaluated against every source. Approximation-error rows are a diagnostic subset, not a whole-layout accuracy guarantee.</p>
  `
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const fixture = el<HTMLSelectElement>('[data-control="fixture"]'); const count = el<HTMLSelectElement>('[data-control="count"]')
  const slots = el<HTMLSelectElement>('[data-control="slots"]'); const quality = el<HTMLSelectElement>('[data-control="quality"]')
  const canvas = (name: string): HTMLCanvasElement => el(`[data-canvas="${name}"]`)
  const status = el('[data-output="status"]')
  let input = createFixture('uniform', 8192); let cpu = input.points; let tick = 0; let busy = false; let stopped = false; let destroyed = false
  const lanes: Array<{ name: string; backend: GridBackend; positions: Float32Array }> = []
  const errors: Record<string, string> = {}; const rows: Array<Record<string, unknown>> = []
  const timingRows: PrecisionTimingRow[] = []
  let timingError: string | undefined
  const controls = (): void => {
    host.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(c => { c.disabled = busy })
    el<HTMLButtonElement>('[data-action="stop"]').disabled = !busy
    el<HTMLButtonElement>('[data-action="export"]').disabled = busy || (!rows.length && !timingRows.length)
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
    el('[data-output="centroids"]').replaceChildren()
    el('[data-output="trace"]').replaceChildren()
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
  const step = async (tracing = false, comparingCentroids = false): Promise<boolean> => {
    el('[data-output="centroids"]').replaceChildren()
    el('[data-output="trace"]').replaceChildren()
    const diagnostics: Array<{ name: string; report: Awaited<ReturnType<typeof diagnose>> }> = []
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
        const report = tracing ? await diagnose(lane.backend, actual, input, previous, PARAMETERS, frame, actualStructure) : null
        if (report) diagnostics.push({ name: lane.name, report })
        checks.push(check); snapshots[lane.name] = actual; lane.positions = actual.positions
        const valid = check.structure.valid && check.output.valid && check.local.valid && check.integration.valid && (!report || report.replay.valid)
        el(`[data-status="${lane.name}"]`).textContent = valid ? 'Passed' : 'Mismatch'
      } catch (error) {
        errors[lane.name] = error instanceof Error ? error.message : String(error)
        el(`[data-status="${lane.name}"]`).textContent = 'Failed'; el(`[data-info="${lane.name}"]`).textContent = errors[lane.name]
      }
    }
    if (destroyed) return false
    let centroidComparison: Awaited<ReturnType<typeof compareCentroidPass>> | undefined
    let centroidError: string | undefined
    if (comparingCentroids) {
      status.textContent = `Comparing centroid and far-field arithmetic at tick ${tick + 1}…`
      try {
        if (!snapshots.WebGPU) throw new Error('Inline WebGPU result unavailable')
        centroidComparison = await compareCentroidPass(input, previous, PARAMETERS, frame, snapshots.WebGPU)
      } catch (error) { centroidError = error instanceof Error ? error.message : String(error) }
      if (destroyed) return false
    }
    const approximation = approximationError(input, previous, expected.forces, PARAMETERS, frame)
    const cross = snapshots.WebGL && snapshots.WebGPU ? comparePresent(snapshots.WebGPU, snapshots.WebGL, previous) : null
    cpu = expected.positions; render()
    const replayValid = diagnostics.every(d => d.report.replay.valid)
    const passed = replayValid && Boolean(cross?.valid) && checks.length === 2 && Object.keys(errors).length === 0 &&
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
      diagnostics,
      centroidComparison,
      centroidError,
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
    if (comparingCentroids) {
      const target = el('[data-output="centroids"]')
      if (centroidComparison) {
        const c = centroidComparison
        const candidates = [
          { label: 'Stored', result: c }, { label: 'Corrected division', result: c.corrected },
          { label: 'Refined far arithmetic', result: c.refined }, { label: 'Refined + stored contributions', result: c.materialized },
          { label: 'Streamed contributions', result: c.streamed },
        ]
        const comparisonRows = [{ label: 'Inline', check: c.inline }, ...candidates.map(v => ({ label: v.label, check: v.result.stored }))]
          .map(({ label, check }) => `<tr><td>${label}</td><td>${check.forces.failures} / ${num(check.forces.maxError)}</td>
            <td>${check.positions.failures} / ${num(check.positions.maxError)}</td></tr>`).join('')
        target.innerHTML = `<details open><summary>Centroid and far-field comparison · tick ${tick}</summary>
          <p class="demo-note">Same input, bounds, samples and unchanged CPU reference. Only WebGPU centroid and far-field arithmetic differ.</p>
          <table><thead><tr><th>WebGPU variant</th><th>Force failures / max error</th><th>Position failures / max error</th></tr></thead>
          <tbody>${comparisonRows}</tbody></table>
          ${candidates.map(({ label, result: r }) => `<h3>${label}: ${r.storedPassed ? 'Pass' : 'Mismatch'}</h3>
            <p class="demo-note">Structure ${r.structural.valid ? 'Pass' : 'FAIL'} · centroid budget ${r.centroidCheck.valid ? 'Pass' : 'FAIL'} ·
              replay ${r.replay.valid ? 'Pass' : 'FAIL'}. ${r.centroids.differingComponents} centroid components differ from CPU division;
              max ${r.centroids.maxUlp} ULP. CPU using GPU centroids: ${r.sameCentroids.forces.failures} force /
              ${r.sameCentroids.positions.failures} position failures (diagnostic only).</p>
            ${r.division ? `<p class="demo-note">Division corpus: ${r.division.cases} cases, ${r.division.mismatches} bit-pattern mismatches.</p>` : ''}
            ${r.contributions
    ? `<details><summary>128×128 contributions · point ${r.contributions.target} · replay ${r.contributions.replay.valid ? 'Pass' : 'FAIL'}</summary>
              <table><thead><tr><th>Operation</th><th>Differing components</th><th>Max error</th></tr></thead>
              <tbody>${r.contributions.summary.map(s => `<tr><td>${s.stage}</td><td>${s.differing}</td>
                <td>${num(s.maxError)}</td></tr>`).join('')}</tbody></table>
              <p class="demo-note">Instrumented replay; detailed cell rows are included in JSON.
                Differences here are exact-value differences, not tolerance failures.</p></details>`
    : ''}
            <p class="demo-note">Extra working storage: ${(r.extraStorageBytes / 1048576).toFixed(2)} MiB ·
              ${r.extraDispatches} extra dispatch${r.extraDispatches === 1 ? '' : 'es'} per tick. See Benchmark precision for measured cost.</p>
            <details><summary>${label} · inspect force stages</summary>
              <table><thead><tr><th>Stage</th><th>Failures</th><th>Max error</th><th>Worst budget ratio</th><th>Point / axis</th></tr></thead>
                <tbody>${r.stages.map(s => `<tr><td>${s.stage}</td><td>${s.check.failures}</td><td>${num(s.check.maxError)}</td>
                  <td>${s.worst ? num(s.worst.ratio) : '—'}</td><td>${s.worst ? `${s.worst.point} / ${s.worst.axis}` : '—'}</td></tr>`).join('')}
              </tbody></table></details>`).join('')}
          <p class="demo-note">The canvases above keep the inline baseline. Arithmetic variants are opt-in diagnostics;
            a passing candidate does not change the baseline verdict.</p></details>`
      } else { target.textContent = `Centroid comparison unavailable: ${centroidError}` }
      target.style.scrollMarginTop = `${el('.playback-toolbar').offsetHeight + 16}px`
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    if (tracing) {
      const labels = new Map([
        ['reciprocal', 'Rounded reciprocal'],
        ['fused-reciprocal', 'Fused centroid delta'],
        ['fused-reciprocal-rsqrt', 'Fused delta + inverse roots'],
      ])
      el('[data-output="trace"]').innerHTML = `<details open><summary>Precision trace · tick ${tick}</summary>
        <p class="demo-note">CPU uses each backend’s own cell aggregates and selected neighbors. Far rows are cumulative after each level.
        Ratio is error / unchanged component budget; above 1 fails. Replay checks the instrumented force against normal execution.</p>
        ${diagnostics.map(d => `<h3>${d.name} · replay ${d.report.replay.valid ? 'Pass' : 'FAIL — trace is not representative'}</h3>
          <table><thead><tr><th>Stage</th><th>Failures</th><th>Max error</th><th>Worst budget ratio</th><th>Target / axis</th></tr></thead>
          <tbody>${d.report.stages.map(s => `<tr><td>${s.stage}</td><td>${s.check.failures}</td><td>${num(s.check.maxError)}</td>
            <td>${s.worst ? num(s.worst.ratio) : '—'}</td><td>${s.worst ? `${s.worst.point} / ${s.worst.axis}` : '—'}</td></tr>`).join('')}</tbody></table>
          <p class="demo-note">Alternative CPU arithmetic (diagnostic only):
          ${d.report.hypotheses.map(h => `${labels.get(h.arithmetic)}: ` +
            `${h.output.forces.failures} force / ${h.output.positions.failures} position failures`).join('; ')}.
          These alternatives do not replace the baseline or change its verdict.</p>
          <details><summary>Follow worst final-force component: point ${d.report.target?.point} / ${d.report.target?.axis}</summary>
            <table><thead><tr><th>Stage</th><th>GPU value</th><th>CPU value</th><th>Absolute error</th></tr></thead>
            <tbody>${d.report.target?.stages.map(s => `<tr><td>${s.stage}</td><td>${s.actual.toPrecision(9)}</td>
              <td>${s.expected.toPrecision(9)}</td><td>${num(s.error)}</td></tr>`).join('') ?? ''}</tbody></table></details>`).join('')}
        </details>`
      el('[data-output="trace"] summary').focus({ preventScroll: true })
      el('[data-output="trace"]').style.scrollMarginTop = `${el('.playback-toolbar').offsetHeight + 16}px`
      el('[data-output="trace"]').scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    el('[data-status="CPU"]').textContent = 'Computed'
    const verdict = passed ? 'Passed' : checks.length < 2 ? 'Partial comparison' : 'Mismatch'
    status.textContent = `${comparingCentroids ? 'Inline baseline: ' : ''}${verdict} · tick ${tick}. ${comparingCentroids
      ? `Stored centroid variant: ${centroidError ? 'unavailable' : centroidComparison?.storedPassed ? 'Passed' : 'Mismatch'}; ` +
        `corrected division: ${centroidError ? 'unavailable' : centroidComparison?.corrected.storedPassed ? 'Passed' : 'Mismatch'}; ` +
        `refined + stored contributions: ${centroidError ? 'unavailable' : centroidComparison?.materialized.storedPassed ? 'Passed' : 'Mismatch'}; ` +
        `streamed: ${centroidError ? 'unavailable' : centroidComparison?.streamed.storedPassed ? 'Passed' : 'Mismatch'}.`
      : 'Approximation error is reported separately.'}`
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
  el('[data-action="centroids"]').addEventListener('click', () => { task(async () => { await step(false, true) }) })
  el('[data-action="trace"]').addEventListener('click', () => { task(async () => { await step(true) }) })
  el('[data-action="step"]').addEventListener('click', () => { task(async () => { await step() }) })
  el('[data-action="three"]').addEventListener('click', () => {
    task(async () => {
      for (let i = 0; i < 3; i++) { if (stopped || destroyed || !await step()) break; await new Promise(resolve => setTimeout(resolve, 0)) }
      if (stopped && !destroyed) status.textContent = `Stopped at tick ${tick}; completed results can be exported.`
    })
  })
  const renderTiming = (): void => {
    const num = (n: number | null | undefined): string => n === null || n === undefined ? 'unavailable' : n.toFixed(3)
    el('[data-output="timing"]').innerHTML = `<h3>Precision performance</h3>
      <p class="demo-note">GPU milliseconds per repeated fixed-input operation: seven samples after two warmups, common batch per case,
        rotating variant order. Readback, validation, uploads and rendering are outside the GPU interval.
        Inline is a control; a CPU mismatch disqualifies it as a precision replacement. Stop retains partial rows.</p>
      <table><thead><tr><th>Workload</th><th>Variant</th><th>GPU ms · median [range]</th><th>CPU check</th><th>Extra MiB</th></tr></thead>
      <tbody>${timingRows.map(r => {
    const valid = r.validation.length && r.validation.every(v => v.valid) && r.structure?.valid &&
      (r.mode === 'inline' || r.centroidDifferences === 0)
    const range = r.summary?.gpuRange
    return `<tr><td>${r.fixture} · ${r.count} · ${r.stage === 'force' ? 'grid + force' : 'step'}</td>
          <td>${MODE_LABELS[r.mode]}</td><td>${r.summary ? num(r.summary.gpuMs) : `${r.samples.length}/7 samples`}
          ${range ? `[${num(range[0])}–${num(range[1])}]` : ''}</td>
          <td>${r.validation.length ? valid ? 'Pass' : 'FAIL' : 'pending'}</td><td>${(r.extraStorageBytes / 1048576).toFixed(2)}</td></tr>`
  }).join('')}</tbody></table>
      <p class="demo-note">The fixed sweep uses eight samples per cell and precise quality, independent of the demo controls.
        “Unavailable” means no valid GPU timer; CPU completion measurements remain separate in JSON.
        Figures include the diagnostic dense-cell builder. They are not isolated far-force timings or independent trajectories.</p>`
  }
  el('[data-action="benchmark"]').addEventListener('click', () => {
    task(async () => {
      timingRows.length = 0; timingError = undefined; renderTiming()
      const panel = el('[data-output="timing"]')
      panel.style.scrollMarginTop = `${el('.playback-toolbar').offsetHeight + 16}px`
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' })
      try {
        await runPrecisionSweep({
          rows: timingRows,
          cancelled: () => stopped || destroyed,
          progress: message => { if (!destroyed) { status.textContent = message; renderTiming() } },
        })
        if (!destroyed) {
          status.textContent = stopped
            ? 'Benchmark stopped; partial results can be exported.'
            : 'Precision benchmark complete; validation is shown beside each timing.'
        }
      } catch (error) {
        timingError = error instanceof Error ? error.message : String(error)
        throw error
      } finally { if (!destroyed) renderTiming() }
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
      precisionTimings: timingRows,
      precisionTimingError: timingError,
      errors,
    }
    const serialized = JSON.stringify(capture, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)
    const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'cosmos-many-body-grid.json'; a.click(); URL.revokeObjectURL(url)
  })
  await task(setup)
  return { destroy (): void { destroyed = true; stopped = true; cleanup() } }
}
