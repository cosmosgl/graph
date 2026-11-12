import { scientific, yesNo, checkResult } from '../../runtime/result-format'
import { mountRunLayout, disposeRunLayout, summarizeRun } from '../../runtime/run-layout'
import type { ExperimentInstance } from '../../runtime/experiment'
import { validationContracts } from '../../runtime/validation'
import { gravity } from '../combined-layout/reference'
import { cpuSums, gravityFixture, gravityResult, sumFixture, type SumFixture } from './model'
import { nativeDiagnostics, productionGravity } from './gpu'

const number = (value: number | null): string => scientific(value, 5)
export function createPrecisionView (host: HTMLElement): ExperimentInstance {
  let runError: string | undefined
  host.innerHTML = `<p class="demo-note"
      data-run-part="explanation">Compare mathematical error and legacy compatibility separately.
    No production accuracy threshold or performance verdict is assigned. Every backend receives the same frozen float32 inputs.</p>
    <div
      data-run-part="configuration" class="scale-toolbar">
      <label>Records <select data-count><option>257</option><option>1024</option><option>4096</option></select></label>
      <label>Gravity seed <input data-seed type="number" value="5931" min="0" max="4294967295" step="1"></label>
      <label>Sum fixture <select data-fixture><option value="cancellation">Cancellation</option><option value="positive">Positive integers</option>
        <option value="balanced">Balanced integers</option></select></label>
      <div class="controls"><button data-run class="button-primary"
      data-run-action="primary">Run frozen diagnostics</button>
        <button data-export disabled
      data-run-action="export">Export JSON</button></div>
    </div><p role="status" data-status
      data-run-part="status">Ready. GPU results depend on the selected browser and device.</p>
    <div class="many-body-results precision-results"
      data-run-part="results" data-results></div>
    <p class="demo-note">Read the <a href="#/precision-diagnostics/docs/method">method</a>,
      <a href="#/validation-workflow">validation workflow</a> and <a href="#/numerical-research">sourced research report</a>.
      The sum kernels are diagnostic WGSL, not production WebGL blend reductions. Layouts and runtime performance are not assessed.</p>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const run = el<HTMLButtonElement>('[data-run]'); const download = el<HTMLButtonElement>('[data-export]')
  let destroyed = false; let busy = false
  let report: {
    schemaVersion: number; experiment: string; recordedAt: string; browser: string; gpuApiImplementation: string;
    validationContract: typeof validationContracts[string]; parameters: { count: number; seed: number; fixture: SumFixture };
    input: { points: Float32Array; sumValues: Float32Array }; gravity: ReturnType<typeof gravityResult>[];
    gravityOutputs: Array<{ name: string; forces: Float32Array }>;
    sums: Array<{ name: string; value: number; exact: number; absoluteError: number; finite: boolean }>;
    devices: Record<string, string>; errors: Record<string, string>;
    quality: string; performance: string;
  } | undefined
  const render = (): void => {
    if (!report || destroyed) return
    const results = el('[data-results]'); results.replaceChildren()
    // Only numeric and source-controlled labels enter the tables; device/errors use textContent below.
    results.innerHTML = `<h3>Gravity force accuracy</h3><p class="demo-note">Tables scroll horizontally on narrow screens.</p>
      <div class="precision-table" tabindex="0" role="region" aria-label="Gravity force accuracy">
      <table><thead><tr><th>Backend</th><th>Finite</th><th>Max absolute error</th><th>Non-axis max error</th>
      <th>RMS error</th><th>Relative L2 error</th><th>Legacy compatibility</th></tr></thead>
      <tbody>${report.gravity.map(row => `<tr><td>${row.name}</td><td>${yesNo(row.mathematicalError.finite)}</td>
        <td>${number(row.mathematicalError.maxAbsolute)}</td><td>${number(row.nonAxisError.maxAbsolute)}</td>
        <td>${number(row.mathematicalError.rms)}</td><td>${number(row.mathematicalError.relativeL2)}</td>
        <td>${checkResult(row.legacyCompatibility.valid)} · ${row.legacyCompatibility.failures} failures</td></tr>`)
    .join('')}</tbody></table></div>
      <p class="demo-note">Mathematical target: linear attraction toward (0, 0), with alpha 1, gravity 0.25 and a float32 0.1 coefficient.
        Legacy target: the existing stepwise float32 CPU polar model, including its original tolerance.
        Neither an accuracy threshold nor a production candidate is selected. Zero CPU self-difference is not independent evidence.
        Axis and non-axis errors are exported separately because native atan2 has restricted accuracy guarantees near its special cases.</p>
      <h3>Sum accuracy</h3><div class="precision-table" tabindex="0" role="region" aria-label="Sum accuracy">
      <table><thead><tr><th>Backend</th><th>Result</th><th>Exact fixture sum</th><th>Absolute error</th><th>Finite</th></tr></thead>
      <tbody>${report.sums.map(row => `<tr><td>${row.name}</td><td>${number(row.value)}</td><td>${number(row.exact)}</td>
        <td>${number(row.absoluteError)}</td><td>${yesNo(row.finite)}</td></tr>`).join('')}</tbody></table></div>
      <p class="demo-note">These bounded integer fixtures have exact double-precision sums. CPU order models round to float32;
        GPU results may differ because of permitted evaluation changes. Differences alone do not identify compiler behavior.</p>`
    for (const [name, info] of Object.entries(report.devices)) {
      const p = document.createElement('p'); p.className = 'demo-note'; p.textContent = `${name}: ${info}`; results.append(p)
    }
    for (const [name, error] of Object.entries(report.errors)) {
      const p = document.createElement('p'); p.textContent = `${name} unavailable: ${error}`; results.append(p)
    }
  }
  run.addEventListener('click', () => {
    if (busy || destroyed) return
    const execute = async (): Promise<void> => {
      busy = true; report = undefined; download.disabled = true; run.disabled = true
      el('[data-results]').replaceChildren()
      host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(c => { c.disabled = true })
      const status = el('[data-status]')
      try {
        const count = Number(el<HTMLSelectElement>('[data-count]').value); const seed = Number(el<HTMLInputElement>('[data-seed]').value)
        const fixture = el<HTMLSelectElement>('[data-fixture]').value as SumFixture
        const points = gravityFixture(count, seed); const values = sumFixture(fixture, count); const sums = cpuSums(values)
        const current = {
          schemaVersion: 1,
          experiment: 'precision-diagnostics',
          recordedAt: new Date().toISOString(),
          browser: navigator.userAgent,
          gpuApiImplementation: 'luma-resources-v1',
          validationContract: validationContracts['precision-diagnostics'],
          parameters: { count, seed, fixture },
          input: { points, sumValues: values },
          gravity: [gravityResult('CPU float32 polar model', gravity(points, 1).forces, points)],
          gravityOutputs: [{ name: 'CPU float32 polar model', forces: gravity(points, 1).forces }],
          sums: (['serial', 'blocked', 'tree'] as const).map(name => ({
            name: `CPU float32 ${name}`,
            value: sums[name],
            exact: sums.exact,
            absoluteError: Math.abs(sums[name] - sums.exact),
            finite: Number.isFinite(sums[name]),
          })),
          devices: {} as Record<string, string>,
          errors: {} as Record<string, string>,
          quality: 'not-assessed',
          performance: 'not-assessed',
        }
        report = current
        status.textContent = 'Checking production GLSL gravity…'
        try {
          const result = await productionGravity(points)
          current.devices.webgl = result.device; current.gravity.push(gravityResult('Production GLSL polar', result.forces, points))
          current.gravityOutputs.push({ name: 'Production GLSL polar', forces: result.forces })
        } catch (error) { runError = String(error); current.errors.webgl = String(error) }
        if (destroyed) return
        status.textContent = 'Checking native WGSL gravity and sums…'
        try {
          const result = await nativeDiagnostics(points, values)
          current.devices.webgpu = result.device
          for (const row of result.gravity) { current.gravity.push(gravityResult(row.name, row.forces, points)); current.gravityOutputs.push(row) }
          for (const row of result.sums) {
            current.sums.push({
              ...row, exact: sums.exact, absoluteError: Math.abs(row.value - sums.exact), finite: Number.isFinite(row.value),
            })
          }
        } catch (error) { runError = String(error); current.errors.webgpu = String(error) }
        if (destroyed) return
        render(); status.textContent = Object.keys(current.errors).length
          ? 'Partial diagnostics. Unavailable GPU paths remain reported; CPU results are not GPU validation.'
          : 'Diagnostics completed. Inspect error and compatibility separately; no production approval or performance claim.'
      } catch (error) { runError = String(error); if (!destroyed) status.textContent = String(error) } finally {
        busy = false
        if (!destroyed) {
          run.disabled = false; download.disabled = !report
          host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(c => { c.disabled = false })
        }
      }
    }
    execute().catch(error => { if (!destroyed) el('[data-status]').textContent = String(error) })
  })
  download.addEventListener('click', () => {
    if (!report || busy) return
    const json = JSON.stringify(report, (_key, value) => ArrayBuffer.isView(value)
      ? Array.from(value as Float32Array)
      : typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a')
    link.href = url; link.download = 'cosmos-precision-diagnostics.json'; link.click(); URL.revokeObjectURL(url)
  })
  mountRunLayout(host, () => summarizeRun(
    busy ? 'Running' : report ? 'Complete' : 'Ready',
    report?.gravity.map(r => r.legacyCompatibility.valid) ?? [],
    'Mathematical accuracy has no pass budget; trajectories, quality and cost.',
    Object.keys(report?.errors ?? {}),
    runError,
    'legacy compatibility comparisons'), { experiment: 'precision-diagnostics', devices: () => Object.values(report?.devices ?? {}) })
  return { destroy (): void { disposeRunLayout(host); destroyed = true } }
}
