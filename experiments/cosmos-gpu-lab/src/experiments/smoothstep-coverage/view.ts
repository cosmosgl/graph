import type { ExperimentInstance } from '../../runtime/experiment'
import { createResultTables } from '../../runtime/result-tables'
import type { Snapshot } from '../straight-links/backend'
import { FIXED_INPUTS, fixedInputProbe, type FixedRow } from './fixed-input'
import { compareLine, type LineRun } from './line-study'
import { tracePosition, type PositionTrace } from './position-trace'
import { roundingExample } from './rounding-example'

const format = (value: number): string => Number.isFinite(value) ? String(value) : 'unavailable'
const lanes = ['webgl', 'webgpu'] as const
const names = { webgl: 'WebGL', webgpu: 'WebGPU' }
const crop = { x: 76, y: 93, width: 48, height: 6 }

function drawCrop (canvas: HTMLCanvasElement, snapshot: Snapshot): void {
  const source = document.createElement('canvas'); source.width = snapshot.width; source.height = snapshot.height
  const context = source.getContext('2d'); const output = canvas.getContext('2d')
  if (!context || !output) throw new Error('A 2D canvas is required to display the captured pixels')
  // The readback contains blended RGB; ImageData expects unpremultiplied RGB.
  const data = new Uint8ClampedArray(snapshot.color)
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha > 0 && alpha < 255) for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.round(data[i + c] * 255 / alpha))
  }
  context.putImageData(new ImageData(data, snapshot.width, snapshot.height), 0, 0)
  output.clearRect(0, 0, canvas.width, canvas.height); output.imageSmoothingEnabled = false
  output.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
  const cell = canvas.width / crop.width
  output.strokeStyle = '#f4d889'; output.lineWidth = 2
  output.strokeRect((100 - crop.x) * cell + 1, (96 - crop.y) * cell + 1, cell - 2, cell - 2)
}

function fixedTable (rows: FixedRow[]): string {
  const result = (backend: FixedRow['backend'], input: number, formula: FixedRow['formula']): FixedRow => {
    const row = rows.find(item => item.backend === backend && item.input === input && item.formula === formula)
    if (!row) throw new Error('A fixed-input result is missing')
    return row
  }
  return `<h3>Fixed-input scores</h3>
    <p>Each shader received the same three positions in a separate test.</p>
    <table><thead><tr><th>Position</th><th>Backend</th><th>Current score · hard decision</th><th>Revised score · hard decision</th></tr></thead><tbody>
    ${FIXED_INPUTS.flatMap(input => (['WebGL', 'WebGPU'] as const).map(backend => {
    const original = result(backend, input, 'descending'); const revised = result(backend, input, 'ascending')
    const label = (row: FixedRow): string => `${format(row.coverage)} · ${row.drawn ? 'draw' : 'empty'}`
    return `<tr><td>${format(input)}</td><td>${backend}</td><td>${label(original)}</td><td>${label(revised)}</td></tr>`
  })).join('')}</tbody></table>`
}

function lineTable (run: LineRun): string {
  const comparison = (formula: 'descending' | 'ascending'): string => {
    const row = run.pair[formula]
    return `<tr><td>${formula === 'descending' ? 'Current' : 'Revised'}</td><td>${row.passed ? 'Pass' : 'Fail'}</td>
      <td>${row.idDifferences}</td><td>${row.masks.webgl} / ${row.masks.webgpu}</td><td>${row.colors.budgetFailures}</td>
      <td>${row.cpuColors.webgl.budgetFailures} / ${row.cpuColors.webgpu.budgetFailures}</td>
      <td>${row.invisible.webgl} / ${row.invisible.webgpu}</td></tr>`
  }
  return `<h3>Sampled pixel</h3><p>Shift ${format(run.shift)} device pixels · ${run.settings.blend ? 'Blended' : 'Hard'} edge.</p>
    <p>The probe reads the position and score at pixel (100, 96). The regular draws supply the color and picking ID.</p>
    <table><thead><tr><th>Backend / formula</th><th>Position</th><th>Score</th><th>Painted alpha</th><th>Picked ID</th></tr></thead><tbody>
    ${(['webgl', 'webgpu'] as const).flatMap(lane => (['descending', 'ascending'] as const).map(formula => {
    const value = run.samples[lane][formula]
    return `<tr><td>${lane === 'webgl' ? 'WebGL' : 'WebGPU'} · ${formula === 'descending' ? 'current' : 'revised'}</td>
      <td>${value.carrier ? format(value.position) : 'No fragment'}</td><td>${value.carrier ? format(value.coverage) : 'No fragment'}</td>
      <td>${value.color[3]} / 255</td><td>${value.picked === null ? 'background' : `link ${value.picked}`}</td></tr>`
  })).join('')}</tbody></table>
    <p>Changing the formula changed ${run.changes.webgl.color.changedPixels} WebGL color pixels and
    ${run.changes.webgpu.color.changedPixels} WebGPU color pixels. It changed ${run.changes.webgl.ids} WebGL IDs and
    ${run.changes.webgpu.ids} WebGPU IDs.</p>
    <h3>Whole-line checks</h3><p>These keep the original strict comparison: IDs must match, colors may differ by at most 2 / 255,
    and a picked pixel cannot be invisible. CPU counts compare each backend with the independent line model.</p>
    <table><thead><tr><th>Formula</th><th>Strict result</th><th>Different IDs</th><th>CPU ID failures · GL / GPU</th>
    <th>Color failures · GL vs GPU</th><th>CPU color failures · GL / GPU</th><th>Invisible picks · GL / GPU</th></tr></thead>
    <tbody>${comparison('descending')}${comparison('ascending')}</tbody></table>`
}

function traceTable (trace: PositionTrace): string {
  const gl = trace.replays.find(row => row.source === 'webgl' && row.backend === 'webgl')!
  const gpu = trace.replays.find(row => row.source === 'webgl' && row.backend === 'webgpu')!
  const different = trace.lengthSweep.filter(row => row.webgl.local !== row.webgpu.local)
  const matches = trace.lengthSweep.filter(row => row.sharedReciprocal === row.webgpu.local).length
  const example = roundingExample()
  const sample = (row: typeof gl): string => row.sample.available ? format(row.sample.local) : 'No fragment'
  const outcome = gl.sample.available && gpu.sample.available && gl.sample.local !== gpu.sample.local
    ? 'The same saved corners still produce different positions. This points to the step that fills values in across the triangles, ' +
      'including its rasterization and rounding; the trace cannot see the driver’s exact calculation.'
    : 'The two replayed positions do not differ at this pixel on this device. Check the other controls and original draws separately.'
  return `<h3>Same pixel, different place inside the line</h3>
    <p>The screen pixel is the same. The number below describes its place inside the line, from +0.5 at one side to −0.5 at the other.</p>
    <table><thead><tr><th>Check</th><th>Result</th></tr></thead><tbody>
      <tr><td>Same four saved corners?</td><td>${trace.sameVertices ? 'Yes' : 'No'}</td></tr>
      <tr><td>Original line completely inside the screen?</td><td>${trace.unclipped ? 'Yes' : 'No'}</td></tr>
      <tr><td>Screen pixel center · WebGL / WebGPU</td><td>(${gl.sample.pixel.join(', ')}) / (${gpu.sample.pixel.join(', ')})</td></tr>
      <tr><td>Place inside the line · WebGL / WebGPU</td><td>${sample(gl)} / ${sample(gpu)}</td></tr>
      <tr><td>Replayed missing or extra pixels compared with each original probe · GL / GPU</td>
        <td>${gl.carrierDifferences} / ${gpu.carrierDifferences}</td></tr>
      <tr><td>Replayed positions differing from each renderer's original probe · GL / GPU</td>
        <td>${gl.positionDifferences} / ${gpu.positionDifferences}</td></tr></tbody></table>
    <p>${outcome}</p>
    <h3>One way rounding can make a difference</h3>
    <p>For this pixel, a simple mathematical model combines three corner values using the fractions 90/720, 478/720 and 152/720.
    A computer can calculate those fractions separately, or calculate 1/720 once and multiply. In exact math they agree.</p>
    <table><thead><tr><th>Float32 calculation</th><th>Result</th></tr></thead><tbody>
      <tr><td>Divide each fraction</td><td>${format(example.direct)}</td></tr>
      <tr><td>Reuse one rounded 1/720</td><td>${format(example.sharedReciprocal)}</td></tr></tbody></table>
    <p>This example reproduces the two numbers, but it is only an illustration. It matched the WebGPU value for ${matches} of
    ${trace.lengthSweep.length} tested lengths, so it does not predict every result or prove what the driver does.</p>
    <h3>Try different line lengths</h3><p>In this run ${different.length} of ${trace.lengthSweep.length} lengths gave different positions:
    ${different.length ? different.map(row => row.length).join(', ') : 'none'} pixels. Every rectangle and the sampled screen pixel stayed aligned.</p>
    <table><thead><tr><th>Line length</th><th>WebGL position</th><th>WebGPU position</th><th>Rounding example</th></tr></thead><tbody>
      ${trace.lengthSweep.map(row => `<tr><td>${row.length}</td><td>${format(row.webgl.local)}</td><td>${format(row.webgpu.local)}</td>
        <td>${format(row.sharedReciprocal)}</td></tr>`).join('')}</tbody></table>
    <p>These are isolated measurements on this browser and device. They do not change the original line-rendering verdict.</p>`
}

export async function createSmoothstepView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<div class="line-edge-run">
    <span class="visually-hidden" data-progress-status role="status"></span>
    <section id="run-run" aria-label="WebGL and WebGPU comparison">
      <div id="run-configuration" class="choice-controls">
        <div class="choice-control" role="group" aria-labelledby="line-edge-position" aria-describedby="line-edge-position-step">
          <div class="choice-label">
            <span id="line-edge-position">Position</span>
            <small id="line-edge-position-step">1/1024 px</small>
          </div>
          <div class="choice-options">
            <button type="button" data-shift="0" aria-pressed="true">Original</button>
            <button type="button" data-shift="-0.0009765625" aria-pressed="false">Up</button>
            <button type="button" data-shift="0.0009765625" aria-pressed="false">Down</button>
          </div>
        </div>
        <div class="choice-control" role="group" aria-labelledby="line-edge-mode">
          <span id="line-edge-mode" class="choice-label">Edge</span>
          <div class="choice-options">
            <button type="button" data-blend="hard" aria-pressed="true">Hard</button>
            <button type="button" data-blend="blend" aria-pressed="false">Blended</button>
          </div>
        </div>
        <div class="choice-control" role="group" aria-labelledby="line-edge-formula">
          <span id="line-edge-formula" class="choice-label">Formula</span>
          <div class="choice-options">
            <button type="button" data-formula="descending" aria-pressed="true">Current</button>
            <button type="button" data-formula="ascending" aria-pressed="false">Revised</button>
          </div>
        </div>
      </div>
      <p class="line-edge-error" data-run-status role="alert"></p>
      <button type="button" class="button-primary" data-retry-run hidden>Retry comparison</button>
      <span class="line-edge-progress" aria-hidden="true">Comparing…</span>
      <div class="line-edge-samples" data-samples hidden>
        ${lanes.map(lane => `<figure class="line-edge-sample">
          <figcaption><span>${names[lane]}</span><span data-score="${lane}"></span></figcaption>
          <canvas data-canvas="${lane}" width="${crop.width * 10}" height="${crop.height * 10}" aria-label="${names[lane]} line pixels"></canvas>
        </figure>`).join('')}
        <p>The outline marks pixel (100, 96). A hard edge draws it at a score of 0.5 or higher.</p>
      </div>
    </section>
    <section id="run-diagnostics" aria-labelledby="line-edge-trace-title">
      <div class="line-edge-heading">
        <h2 id="line-edge-trace-title">Trace the pixel</h2>
        <span class="line-edge-progress" aria-hidden="true">Tracing…</span>
      </div>
      <p>Both renderers start from the same line corners. The trace shows where each places the pixel inside the line.</p>
      <button type="button" data-trace>Run pixel trace</button>
      <p class="line-edge-error" data-trace-status role="alert"></p>
      <div data-trace-output class="readiness-table"></div>
    </section>
    <section id="run-results" aria-labelledby="line-edge-data-title">
      <h2 id="line-edge-data-title">Run data</h2>
      <p class="case-meta" data-run-device hidden></p>
      <div data-output class="readiness-table"><p>Scores, colors, and picking IDs appear after a comparison.</p></div>
      <button data-export type="button" disabled>Export JSON</button>
    </section>
  </div>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const pressed = (selector: string): HTMLButtonElement => el(`${selector}[aria-pressed="true"]`)
  const comparison = el('#run-run'); const diagnostics = el('#run-diagnostics')
  const progress = el('[data-progress-status]')
  const runError = el('[data-run-status]'); const traceError = el('[data-trace-status]')
  const samples = el('[data-samples]')
  const retry = el<HTMLButtonElement>('[data-retry-run]')
  const exportButton = el<HTMLButtonElement>('[data-export]')
  const choices = host.querySelectorAll<HTMLButtonElement>('.choice-options button')
  const inputs = [...choices, el<HTMLButtonElement>('[data-trace]'), retry]
  const tables = createResultTables(host)
  let busy = false; let destroyed = false; let report: Record<string, unknown> | undefined
  let traced: PositionTrace | undefined; let traceRecordedAt: string | undefined
  const setBusy = (value: boolean): void => {
    exportButton.disabled = value || (!report && !traced)
    inputs.forEach(control => { control.disabled = value })
  }
  const renderSamples = (line: LineRun): void => {
    const activeFormula = pressed('[data-formula]').dataset.formula === 'ascending' ? 'ascending' : 'descending'
    for (const lane of lanes) {
      drawCrop(el<HTMLCanvasElement>(`[data-canvas="${lane}"]`), line.snapshots[lane][activeFormula])
      const pixel = line.samples[lane][activeFormula]
      const rounded = Number(pixel.coverage.toPrecision(7))
      const score = rounded === pixel.coverage ? format(rounded) : `≈${format(rounded)}`
      const painted = pixel.color[3] === 0 ? 'Empty' : 'Drawn'
      el(`[data-score="${lane}"]`).textContent = pixel.carrier ? `${score} · ${painted}` : 'No fragment'
    }
    samples.hidden = false
  }
  const run = async (): Promise<void> => {
    if (busy || destroyed) return
    busy = true; report = undefined; setBusy(true)
    comparison.setAttribute('aria-busy', 'true')
    progress.textContent = 'Comparing WebGL and WebGPU…'
    const shift = Number(pressed('[data-shift]').dataset.shift); const blend = pressed('[data-blend]').dataset.blend === 'blend'
    try {
      const gl = await fixedInputProbe('webgl')
      if (destroyed) return
      const gpu = await fixedInputProbe('webgpu')
      if (destroyed) return
      const line = await compareLine(shift, blend)
      if (destroyed) return
      const rows = [...gl.rows, ...gpu.rows]
      const devices = [gl.info, gpu.info]
      renderSamples(line)
      el('[data-output]').innerHTML = fixedTable(rows) + lineTable(line)
      const device = el('[data-run-device]'); device.textContent = devices.join(' · '); device.hidden = false
      tables.refresh()
      report = {
        experiment: 'smoothstep-coverage',
        recordedAt: new Date().toISOString(),
        browser: navigator.userAgent,
        devices,
        inputs: { positions: FIXED_INPUTS, smoothing: 0.25, lineShift: shift, blend },
        fixedInputs: rows,
        line: { scene: line.scene, settings: line.settings, samples: line.samples, pair: line.pair, changes: line.changes },
      }
      runError.textContent = ''
      retry.hidden = true
      progress.textContent = 'Comparison complete.'
    } catch (cause) {
      if (!destroyed) {
        const previous = samples.hidden ? '' : ' The previews show the previous run.'
        progress.textContent = ''
        runError.textContent = `Comparison unavailable.${previous} ${String(cause)}`
        retry.hidden = false
      }
    } finally {
      busy = false
      if (!destroyed) {
        comparison.setAttribute('aria-busy', 'false')
        setBusy(false)
      }
    }
  }
  const trace = async (): Promise<void> => {
    if (busy || destroyed) return
    busy = true; traced = undefined; traceRecordedAt = undefined; setBusy(true)
    diagnostics.setAttribute('aria-busy', 'true')
    progress.textContent = 'Tracing the pixel…'
    try {
      const result = await tracePosition()
      if (destroyed) return
      traced = result; traceRecordedAt = new Date().toISOString()
      el('[data-trace-output]').innerHTML = traceTable(result)
      tables.refresh()
      traceError.textContent = ''
      progress.textContent = 'Pixel trace complete.'
    } catch (cause) {
      if (!destroyed) {
        progress.textContent = ''
        traceError.textContent = `Pixel trace unavailable. ${String(cause)}`
      }
    } finally {
      busy = false
      if (!destroyed) {
        diagnostics.setAttribute('aria-busy', 'false')
        setBusy(false)
      }
    }
  }
  const startComparison = (): void => { run().catch(() => {}) }
  choices.forEach(button => button.addEventListener('click', () => {
    if (busy || destroyed) return
    for (const option of button.parentElement!.querySelectorAll('button')) {
      option.setAttribute('aria-pressed', String(option === button))
    }
    startComparison()
  }))
  retry.addEventListener('click', startComparison)
  el('[data-trace]').addEventListener('click', () => { trace().catch(() => {}) })
  exportButton.addEventListener('click', () => {
    if (!report && !traced) return
    const data = {
      experiment: 'smoothstep-coverage',
      recordedAt: new Date().toISOString(),
      browser: navigator.userAgent,
      ...report,
      exportedAt: new Date().toISOString(),
      positionTrace: traced,
      positionTraceRecordedAt: traceRecordedAt,
      roundingExample: traced ? roundingExample() : undefined,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'line-edge-comparison.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  startComparison()
  return { destroy: (): void => { destroyed = true; tables.destroy() } }
}
