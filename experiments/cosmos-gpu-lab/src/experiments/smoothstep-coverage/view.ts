import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../../runtime/run-layout'
import { compactRunControls } from '../../runtime/compact-controls'
import type { Snapshot } from '../straight-links/backend'
import { FIXED_INPUTS, fixedInputProbe, type FixedRow } from './fixed-input'
import { compareLine, type Lane, type LineRun } from './line-study'
import { tracePosition, type PositionTrace } from './position-trace'
import { roundingExample } from './rounding-example'

const format = (value: number): string => Number.isFinite(value) ? String(value) : 'unavailable'
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
  output.drawImage(source, 88, 90, 24, 12, 0, 0, canvas.width, canvas.height)
  output.strokeStyle = '#f4d889'; output.lineWidth = 2
  output.strokeRect(12 * canvas.width / 24 + 1, 6 * canvas.height / 12 + 1, canvas.width / 24 - 2, canvas.height / 12 - 2)
}

function fixedTable (rows: FixedRow[]): string {
  const result = (backend: FixedRow['backend'], input: number, formula: FixedRow['formula']): FixedRow => {
    const row = rows.find(item => item.backend === backend && item.input === input && item.formula === formula)
    if (!row) throw new Error('A fixed-input result is missing')
    return row
  }
  return `<h3>1. Give both renderers the same numbers</h3>
    <p>These scores come directly from small GPU programs. “Draw” means the score is at least 0.5; no line was drawn in this step.</p>
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
  return `<h3>2. Draw the actual line</h3><p>This run: shift ${format(run.shift)} device pixel; ${run.settings.blend ? 'blended' : 'hard'} edge.</p>
    <p>The outlined square is pixel (100, 96). The position's sign indicates which side of the line it is on.
    Its position and score come from a separate float probe;
    the color and ID come from the ordinary draws. “No fragment” means the pixel never reached the shader.</p>
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
    <tbody>${comparison('descending')}${comparison('ascending')}</tbody></table>
    <p>These checks cover this line only. They do not approve a production change.</p>`
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
  host.innerHTML = `<div data-run-part="configuration" class="scale-toolbar styling-toolbar">
      <label>Move the line <select data-shift><option value="0">Original position</option><option value="-0.0009765625">Up 1/1024 pixel</option>
        <option value="0.0009765625">Down 1/1024 pixel</option></select>
        <span class="control-guidance">A small move tests the two sides of the edge.</span></label>
      <label>Edge <select data-blend><option value="hard">Hard · a pixel is drawn or empty</option>
        <option value="blend">Blended · the edge fades</option></select></label>
      <div class="controls"><button data-run data-run-action="primary">Run comparison</button>
        <button data-export data-run-action="export" disabled>Export JSON</button></div></div>
    <p data-run-part="status" role="status">Ready. The comparison runs only when you select the button.</p>
    <div data-run-part="visualization"><p>A hard edge draws a pixel when its score is at least 0.5.
      The same part of one line appears four times below; the yellow outline marks one pixel.</p>
      <div class="backend-panels styling-panels smoothstep-panels">${(['webgl', 'webgpu'] as const).flatMap(lane =>
    (['descending', 'ascending'] as const).map(formula => `<article class="backend-panel"><h3>${lane === 'webgl' ? 'WebGL' : 'WebGPU'} ·
          ${formula === 'descending' ? 'current' : 'revised'}</h3><div class="styling-viewport">
          <canvas data-canvas="${lane}-${formula}" width="240" height="120"
            aria-label="${lane} ${formula} line pixels"></canvas></div></article>`)).join('')}</div></div>
    <section data-run-part="results" data-output class="readiness-table"><p>No comparison has run yet.</p></section>
    <div data-run-part="explanation"><p>A hard edge draws a pixel when its coverage score is at least 0.5.
      The current formula uses descending limits; the revised formula uses ascending limits and reverses the result.</p>
      <p>WebGL does not guarantee the descending expression. A difference between the two expressions is useful evidence,
      but matching values on this device do not make the original expression portable.</p></div>
    <section data-run-part="diagnostics"><h3>Trace one pixel's position</h3>
      <p>Give both renderers the same saved line corners, then follow the pixel from the screen into the line.
      This trace always uses the original hard-edge line, regardless of the settings above.</p>
      <button data-trace data-run-action="diagnostic">Trace the pixel</button>
      <div data-trace-output class="readiness-table"><p>No position trace has run yet.</p></div></section>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  let busy = false; let destroyed = false; let error: string | undefined; let report: Record<string, unknown> | undefined
  let traced: PositionTrace | undefined; let traceRecordedAt: string | undefined
  let state = 'Ready'; let devices: string[] = []
  const setBusy = (value: boolean): void => {
    el<HTMLButtonElement>('[data-run]').disabled = value; el<HTMLButtonElement>('[data-trace]').disabled = value
    el<HTMLButtonElement>('[data-export]').disabled = value || (!report && !traced)
    host.querySelectorAll<HTMLSelectElement>('select').forEach(select => { select.disabled = value })
  }
  const run = async (): Promise<void> => {
    if (busy || destroyed) return
    busy = true; error = undefined; report = undefined; state = 'Running'
    setBusy(true)
    const status = el('[role="status"]'); status.textContent = 'Testing the same numbers in both renderers…'
    const shift = Number(el<HTMLSelectElement>('[data-shift]').value); const blend = el<HTMLSelectElement>('[data-blend]').value === 'blend'
    try {
      const gl = await fixedInputProbe('webgl')
      if (destroyed) return
      const gpu = await fixedInputProbe('webgpu')
      if (destroyed) return
      devices = [gl.info, gpu.info]; status.textContent = 'Drawing the same line four ways…'
      const line = await compareLine(shift, blend)
      if (destroyed) return
      const rows = [...gl.rows, ...gpu.rows]
      for (const lane of ['webgl', 'webgpu'] as Lane[]) {
        for (const formula of ['descending', 'ascending'] as const) {
          drawCrop(el<HTMLCanvasElement>(`[data-canvas="${lane}-${formula}"]`), line.snapshots[lane][formula])
        }
      }
      el('[data-output]').innerHTML = fixedTable(rows) + lineTable(line)
      report = {
        experiment: 'smoothstep-coverage',
        recordedAt: new Date().toISOString(),
        browser: navigator.userAgent,
        devices,
        inputs: { positions: FIXED_INPUTS, smoothing: 0.25, lineShift: shift, blend },
        fixedInputs: rows,
        line: { scene: line.scene, settings: line.settings, samples: line.samples, pair: line.pair, changes: line.changes },
      }
      state = 'Measured'; status.textContent = 'Comparison complete. Inspect the scores and line pixels below.'
    } catch (cause) {
      error = String(cause); state = 'Failed'
      if (!destroyed) status.textContent = `Comparison unavailable: ${error}`
    } finally {
      busy = false
      if (!destroyed) setBusy(false)
    }
  }
  const trace = async (): Promise<void> => {
    if (busy || destroyed) return
    busy = true; error = undefined; traced = undefined; traceRecordedAt = undefined; state = 'Tracing'; setBusy(true)
    const status = el('[role="status"]'); status.textContent = 'Following the same pixel through both renderers…'
    try {
      const result = await tracePosition()
      if (destroyed) return
      traced = result; traceRecordedAt = new Date().toISOString(); devices = [result.info.webgl, result.info.webgpu]
      el('[data-trace-output]').innerHTML = traceTable(result)
      state = 'Measured'; status.textContent = 'Pixel trace complete. See the results under Diagnostics.'
    } catch (cause) {
      error = String(cause); state = 'Failed'
      if (!destroyed) status.textContent = `Pixel trace unavailable: ${error}`
    } finally { busy = false; if (!destroyed) setBusy(false) }
  }
  el('[data-run]').addEventListener('click', () => { run().catch(cause => { error = String(cause) }) })
  el('[data-trace]').addEventListener('click', () => { trace().catch(cause => { error = String(cause) }) })
  host.querySelectorAll<HTMLSelectElement>('select').forEach(select => select.addEventListener('change', () => {
    if (!report || busy || destroyed) return
    report = undefined; state = 'Ready'; el<HTMLButtonElement>('[data-export]').disabled = !traced
    el('[role="status"]').textContent = 'Settings changed. The results shown are from the previous run; run again to update them.'
  }))
  el('[data-export]').addEventListener('click', () => {
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
  mountRunLayout(host, () => summarizeRun(state, [], 'Other lines, caps, devices and production changes', [], error),
    { experiment: 'smoothstep-coverage', devices: () => devices })
  compactRunControls(host, { diagnostics: true })
  return { destroy: (): void => { destroyed = true; disposeRunLayout(host) } }
}
