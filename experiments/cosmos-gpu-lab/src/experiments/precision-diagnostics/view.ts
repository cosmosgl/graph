import { scientific, yesNo, checkResult } from '../../runtime/result-format'
import { mountRunLayout, disposeRunLayout, summarizeRun } from '../../runtime/run-layout'
import type { ExperimentInstance } from '../../runtime/experiment'
import { validationContracts } from '../../runtime/validation'
import { gravity } from '../combined-layout/reference'
import { cpuSums, gravityFixture, gravityResult, sumFixture, type SumFixture } from './model'
import { nativeDiagnostics, productionGravity } from './gpu'
import { precisionCases } from './cases'

const number = (value: number | null): string => scientific(value, 5)
const sumNumber = (value: number): string => Number.isFinite(value) && Number.isSafeInteger(value)
  ? value.toLocaleString('en-US')
  : scientific(value, 5)
const sumLabel = (name: string): string => {
  const backend = name.startsWith('CPU') ? 'CPU' : 'WebGPU'
  const method = name.includes('serial') ? 'one at a time' : name.includes('blocked') ? 'groups of 64' : 'tree of 256 partial sums'
  return `${backend} · ${method}`
}
type PrecisionCase = 'addition-order' | 'gravity-accuracy'
type Report = {
  schemaVersion: 2; experiment: string; case: PrecisionCase; recordedAt: string; browser: string; gpuApiImplementation: string;
  validationContract: typeof validationContracts[string]; parameters: { count: number; seed?: number; fixture?: SumFixture };
  input: { points?: Float32Array; sumValues?: Float32Array }; gravity: ReturnType<typeof gravityResult>[];
  gravityOutputs: Array<{ name: string; forces: Float32Array }>;
  sums: Array<{ name: string; value: number; exact: number; absoluteError: number; finite: boolean }>;
  devices: Record<string, string>; errors: Record<string, string>; quality: string; performance: string;
}

export function createPrecisionView (host: HTMLElement, caseId: string = 'addition-order'): ExperimentInstance {
  if (caseId !== 'addition-order' && caseId !== 'gravity-accuracy') throw new Error(`Unknown precision case: ${caseId}`)
  const mode: PrecisionCase = caseId
  const isAddition = mode === 'addition-order'
  const selectedCase = precisionCases.find(item => item.id === mode)!
  const contract = {
    question: selectedCase.question,
    reference: selectedCase.reference,
    acceptance: selectedCase.acceptance,
    coverage: isAddition
      ? 'Selected integer input and count, using CPU float32 and WebGPU addition-order models.'
      : 'Selected finite frozen points, using CPU, production WebGL and native WebGPU gravity calculations.',
    limits: isAddition
      ? 'No accuracy pass threshold, performance or production readiness assessment.'
      : 'No mathematical accuracy threshold, integration, trajectory or performance assessment.',
  }
  let runError: string | undefined
  host.innerHTML = `<div data-run-part="configuration" class="scale-toolbar">
      <label>${isAddition ? 'Numbers' : 'Points'} <select data-records>
        <option ${isAddition ? '' : 'selected'}>257</option><option ${isAddition ? 'selected' : ''}>1024</option><option>4096</option>
      </select></label>
      ${isAddition
    ? '<label>Input <select data-fixture><option value="cancellation">Cancellation</option><option value="positive">Positive integers</option>' +
        '<option value="balanced">Balanced integers</option></select></label>'
    : '<label>Input seed <input data-seed type="number" value="5931" min="0" max="4294967295" step="1"></label>'}
    </div>
    <div class="controls"><button data-run class="button-primary" data-run-action="primary">${isAddition ? 'Compare sums' : 'Compare gravity'}</button>
      <button data-export disabled data-run-action="export">Export JSON</button></div>
    <p role="status" data-status data-run-part="status">Ready. No comparison has run in this session.</p>
    <p class="demo-note" data-run-part="visualization" data-input-description></p>
    <div class="precision-results" data-run-part="results" data-results></div>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const run = el<HTMLButtonElement>('[data-run]'); const download = el<HTMLButtonElement>('[data-export]')
  let destroyed = false; let busy = false; let report: Report | undefined
  const describeInput = (): void => {
    const count = Number(el<HTMLSelectElement>('[data-records]').value)
    if (isAddition) {
      const fixture = el<HTMLSelectElement>('[data-fixture]').value as SumFixture
      const pattern = fixture === 'cancellation'
        ? '16,777,216, 1, −16,777,216, 1'
        : fixture === 'positive' ? '1, 2, 3, 4' : '1,024, −1,024, 1, −1'
      const exact = cpuSums(sumFixture(fixture, count)).exact
      el('[data-input-description]').textContent = `The input repeats ${pattern}. For ${count.toLocaleString('en-US')} numbers, ` +
        `the exact sum is ${sumNumber(exact)}. Every method receives the same values.`
    } else {
      el('[data-input-description]').textContent = `All paths calculate forces for the same ${count.toLocaleString('en-US')} frozen points. ` +
        'Mathematical error and compatibility with the existing float32 model answer different questions.'
    }
  }
  const render = (): void => {
    if (!report || destroyed) return
    const results = el('[data-results]'); results.replaceChildren()
    // Only numeric and source-controlled labels enter the tables; device/errors use textContent below.
    if (isAddition) {
      results.innerHTML = `<h3>Addition results</h3><p class="demo-note">The exact sum is ${sumNumber(report.sums[0].exact)}. ` +
        `These are measured results, not pass/fail checks.</p>
        <div class="precision-table" tabindex="0" role="region" aria-label="Addition results">
        <table><thead><tr><th>Method</th><th>Result</th><th>Exact sum</th><th>Absolute error</th><th>Finite</th></tr></thead>
        <tbody>${report.sums.map(row => `<tr><td>${sumLabel(row.name)}</td><td>${sumNumber(row.value)}</td><td>${sumNumber(row.exact)}</td>
          <td>${sumNumber(row.absoluteError)}</td><td>${yesNo(row.finite)}</td></tr>`).join('')}</tbody></table></div>
        <p class="demo-note">CPU models round each step to float32; GPU arithmetic can differ. A different sum alone does not identify its cause.</p>`
    } else {
      results.innerHTML = '<h3>Gravity force results</h3><p class="demo-note">Error is measured against the intended linear force. ' +
        `Compatibility uses the existing float32 CPU model and its unchanged tolerance.</p>
        <div class="precision-table" tabindex="0" role="region" aria-label="Gravity force results">
        <table><thead><tr><th>Backend</th><th>Finite</th><th>Max absolute error</th><th>Non-axis max error</th>
        <th>RMS error</th><th>Relative L2 error</th><th>Legacy compatibility</th></tr></thead>
        <tbody>${report.gravity.map(row => `<tr><td>${row.name}</td><td>${yesNo(row.mathematicalError.finite)}</td>
          <td>${number(row.mathematicalError.maxAbsolute)}</td><td>${number(row.nonAxisError.maxAbsolute)}</td>
          <td>${number(row.mathematicalError.rms)}</td><td>${number(row.mathematicalError.relativeL2)}</td>
          <td>${checkResult(row.legacyCompatibility.valid)} · ${row.legacyCompatibility.failures} failures</td></tr>`).join('')}</tbody></table></div>
        <p class="demo-note">The CPU model's compatibility with itself is not an independent check. ` +
        'No mathematical accuracy budget or performance verdict is assigned.</p>'
    }
    for (const [name, error] of Object.entries(report.errors)) {
      const backend = name === 'webgl' ? 'WebGL' : name === 'webgpu' ? 'WebGPU' : name
      const p = document.createElement('p'); p.textContent = `${backend} unavailable: ${error}`; results.append(p)
    }
  }
  const invalidate = (): void => {
    if (busy || destroyed) return
    report = undefined; runError = undefined; download.disabled = true; el('[data-results]').replaceChildren()
    el('[data-status]').textContent = 'Ready. No comparison has run for these settings.'
    describeInput()
  }
  host.addEventListener('input', invalidate)
  run.addEventListener('click', () => {
    if (busy || destroyed) return
    const execute = async (): Promise<void> => {
      busy = true; report = undefined; runError = undefined; download.disabled = true; run.disabled = true
      el('[data-results]').replaceChildren()
      host.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(c => { c.disabled = true })
      const status = el('[data-status]')
      try {
        const count = Number(el<HTMLSelectElement>('[data-records]').value)
        const seed = isAddition ? undefined : Number(el<HTMLInputElement>('[data-seed]').value)
        const fixture = isAddition ? el<HTMLSelectElement>('[data-fixture]').value as SumFixture : undefined
        const points = isAddition ? new Float32Array() : gravityFixture(count, seed)
        const values = fixture ? sumFixture(fixture, count) : new Float32Array()
        const cpuForces = isAddition ? undefined : gravity(points, 1).forces
        const sums = isAddition ? cpuSums(values) : undefined
        const current: Report = {
          schemaVersion: 2,
          experiment: 'precision-diagnostics',
          case: mode,
          recordedAt: new Date().toISOString(),
          browser: navigator.userAgent,
          gpuApiImplementation: 'luma-resources-v1',
          validationContract: contract,
          parameters: { count, ...(seed === undefined ? {} : { seed }), ...(fixture ? { fixture } : {}) },
          input: isAddition ? { sumValues: values } : { points },
          gravity: cpuForces ? [gravityResult('CPU float32 polar model', cpuForces, points)] : [],
          gravityOutputs: cpuForces ? [{ name: 'CPU float32 polar model', forces: cpuForces }] : [],
          sums: sums
            ? (['serial', 'blocked', 'tree'] as const).map(name => ({
              name: `CPU float32 ${name}`,
              value: sums[name],
              exact: sums.exact,
              absoluteError: Math.abs(sums[name] - sums.exact),
              finite: Number.isFinite(sums[name]),
            }))
            : [],
          devices: {},
          errors: {},
          quality: 'not-assessed',
          performance: 'not-assessed',
        }
        report = current
        if (!isAddition) {
          status.textContent = 'Checking production WebGL gravity…'
          try {
            const result = await productionGravity(points)
            current.devices.webgl = result.device; current.gravity.push(gravityResult('Production GLSL polar', result.forces, points))
            current.gravityOutputs.push({ name: 'Production GLSL polar', forces: result.forces })
          } catch (error) { current.errors.webgl = String(error) }
          if (destroyed) return
        }
        status.textContent = isAddition ? 'Checking WebGPU addition methods…' : 'Checking WebGPU gravity formulas…'
        try {
          const result = await nativeDiagnostics(points, values, isAddition ? 'addition' : 'gravity')
          current.devices.webgpu = result.device
          for (const row of result.gravity) { current.gravity.push(gravityResult(row.name, row.forces, points)); current.gravityOutputs.push(row) }
          for (const row of result.sums) {
            current.sums.push({
              ...row, exact: sums!.exact, absoluteError: Math.abs(row.value - sums!.exact), finite: Number.isFinite(row.value),
            })
          }
        } catch (error) { current.errors.webgpu = String(error) }
        if (destroyed) return
        render()
        if (Object.keys(current.errors).length) {
          status.textContent = 'Partial comparison. See Live results for available results and missing GPU paths.'
        } else if (isAddition) {
          const gpuSums = current.sums.filter(row => !row.name.startsWith('CPU'))
          const exactCount = gpuSums.filter(row => row.value === row.exact).length
          status.textContent = `${exactCount} of ${gpuSums.length} WebGPU methods reached the exact sum of ${sumNumber(sums!.exact)}.`
        } else {
          const gpuResults = current.gravity.slice(1)
          const compatible = gpuResults.filter(row => row.legacyCompatibility.valid).length
          status.textContent = `${compatible} of ${gpuResults.length} GPU paths matched the legacy model within tolerance. See Live results for force errors.`
        }
      } catch (error) { runError = String(error); if (!destroyed) status.textContent = `Comparison failed: ${String(error)}` } finally {
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
    link.href = url; link.download = `cosmos-${mode}.json`; link.click(); URL.revokeObjectURL(url)
  })
  mountRunLayout(host, () => {
    const state = busy ? 'Running' : runError ? 'Failed' : report ? Object.keys(report.errors).length ? 'Partial' : 'Complete' : 'Ready'
    if (isAddition) {
      return {
        state,
        passed: report ? 'No pass threshold' : 'Not run',
        failed: runError
          ? 'Operation error · see status'
          : Object.keys(report?.errors ?? {}).length
            ? `Unavailable: ${Object.keys(report!.errors).join(', ')}`
            : 'None recorded',
        unchecked: 'No accuracy pass threshold; layout, performance and other inputs.',
      }
    }
    return summarizeRun(state, report?.gravity.slice(1).map(r => r.legacyCompatibility.valid) ?? [],
      'Mathematical accuracy has no pass budget; integration, trajectories and cost.',
      Object.keys(report?.errors ?? {}), runError, 'legacy compatibility comparisons')
  }, { experiment: 'precision-diagnostics', scope: contract.coverage, resultsFirst: true, devices: () => Object.values(report?.devices ?? {}) })
  describeInput()
  return { destroy (): void { disposeRunLayout(host); destroyed = true; host.removeEventListener('input', invalidate) } }
}
