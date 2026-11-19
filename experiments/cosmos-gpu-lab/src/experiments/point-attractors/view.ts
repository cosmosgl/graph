import type { ExperimentInstance } from '../../runtime/experiment'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import { compactRunControls } from '../../runtime/compact-controls'
import { graphPalette } from '../../runtime/palette'
import { sharedView } from '../matched-layout/metrics'
import { replaceCanvas } from '../../gpu/force-preview'
import { median } from '../many-body/timing'
import { compareArray } from '../many-body/reference'
import { createBackend, type Api, type AttractorBackend } from './backend'
import { FIXTURES, fixture, type Fixture } from './data'
import { compare, reference } from './reference'
import { createReport, runStudy, rowAccepted, type Report } from './study'
export async function createView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<div class="scale-toolbar" data-run-part="configuration">
    <label>Input<select data-control="fixture">${FIXTURES.map(f => `<option>${f}</option>`).join('')}</select></label>
    <label>Points<select data-control="count"><option>1024</option><option>8192</option></select></label>
    <p class="demo-note">Per-point attraction only. Each point moves toward its own supplied target. Negative strengths push away.
    Semantics uses 12 points, including pinned, absent, coincident and missing-target points. Pinned points are squares.</p></div>
    <button data-action="step" data-run-action="primary">Step and check</button>
    <button data-action="run" data-run-action="primary">Run</button>
    <button data-action="stop" data-run-action="primary">Stop</button>
    <button data-action="reset" data-run-action="primary">Reset</button>
    <p role="status" data-run-part="status">Preparing the comparison…</p>
    <section class="backend-panels many-body-panels" data-run-part="visualization">
    ${['webgl', 'webgpu', 'cpu'].map(api => `<article class="backend-panel"><div class="panel-heading"><h2>${api === 'cpu'
    ? 'CPU reference'
    : api === 'webgl' ? 'Cosmos WebGL' : 'luma WebGPU'}</h2></div>
      <canvas width="480" height="340" data-canvas="${api}" aria-label="${api} point attractors"></canvas></article>`).join('')}</section>
    <div data-run-part="results" data-results></div>
    <section data-run-part="diagnostics"><p>Compare more target inputs and measure isolated GPU force cost. Keep this tab visible during timing.</p>
      <button data-action="study" data-run-action="diagnostic">Run full comparison</button>
      <button data-action="export" data-run-action="export">Export JSON</button>
      <div data-study-results></div></section>
    <p data-run-part="explanation">Run keeps positions on each GPU and evolves the CPU separately. Step and check reads results outside timing.
      The force-only study excludes drawing, integration, input uploads and CPU validation. It cannot establish frame responsiveness.
      These plain circle previews are not a production styling or picking test.</p>`
  const el = <T extends HTMLElement>(s: string): T => host.querySelector<T>(s)!
  const select = (s: string): HTMLSelectElement => el(`[data-control="${s}"]`)
  const canvases = { webgl: el<HTMLCanvasElement>('[data-canvas="webgl"]'), webgpu: el<HTMLCanvasElement>('[data-canvas="webgpu"]') }
  const cpuCanvas = el<HTMLCanvasElement>('[data-canvas="cpu"]'); const status = el('[role="status"]')
  const output = el('[data-results]'); const studyOutput = el('[data-study-results]')
  let input = fixture('individual-targets'); let cpu: Float32Array = input.points.slice(); let tick = 0
  let backends: Partial<Record<Api, AttractorBackend>> = {}; let busy = false; let running = false; let destroyed = false; let cancelled = false
  let frame = 0; let passed = 0; let failed = 0; let error = ''; let report: Report | undefined
  select('fixture').value = 'individual-targets'
  const controls = (): void => {
    if (destroyed) return
    host.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(c => { c.disabled = busy || running })
    el<HTMLButtonElement>('[data-action="stop"]').disabled = !busy && !running
    el<HTMLButtonElement>('[data-action="export"]').disabled = !report || busy
    for (const action of ['step', 'run']) el<HTMLButtonElement>(`[data-action="${action}"]`).disabled ||= Object.keys(backends).length !== 2
  }
  const draw = (): void => {
    const view = sharedView([input.points]); Object.values(backends).forEach(b => b.render(view))
    const ctx = cpuCanvas.getContext('2d')!; ctx.fillStyle = graphPalette.background; ctx.fillRect(0, 0, 480, 340)
    for (let i = 0; i < cpu.length; i += 4) {
      if (cpu[i + 3] > 0.5) continue
      const x = ((cpu[i] - view[0]) * view[2] + 1) * 240; const y = (1 - (cpu[i + 1] - view[1]) * view[3]) * 170
      ctx.fillStyle = cpu[i + 2] > 0.5 ? graphPalette.pinned : graphPalette.point
      if (cpu[i + 2] > 0.5) ctx.fillRect(x - 2.5, y - 2.5, 5, 5)
      else { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fill() }
    }
    status.textContent = `${running ? 'Running' : 'Paused'} · tick ${tick} · ${(input.points.length / 4).toLocaleString()} points · ${select('fixture').value}`
  }
  const stop = (): void => {
    const wasRunning = running
    running = false; cancelled = true; cancelAnimationFrame(frame)
    if (!destroyed && wasRunning) status.textContent = `Paused · tick ${tick} · ${(input.points.length / 4).toLocaleString()} points · ${select('fixture').value}`
    if (!destroyed && busy) status.textContent = 'Stopping after the current operation…'
    controls()
  }
  const initialize = async (): Promise<void> => {
    stop(); busy = true; controls(); error = ''; status.textContent = 'Preparing devices…'
    Object.values(backends).forEach(b => b.destroy()); backends = {}
    input = fixture(select('fixture').value as Fixture, Number(select('count').value)); cpu = input.points.slice(); tick = 0; passed = 0; failed = 0; output.textContent = ''
    try {
      for (const api of ['webgl', 'webgpu'] as const) {
        canvases[api] = replaceCanvas(canvases[api])
        backends[api] = await createBackend(api, canvases[api], input)
        if (destroyed) { backends[api]!.destroy(); return }
      }
      draw()
    } catch (e) { error = String(e); status.textContent = error } finally { busy = false; controls() }
  }
  const step = async (): Promise<void> => {
    busy = true; controls()
    try {
      const expectedCpu = reference(input, cpu); cpu = expectedCpu.positions
      const rows: string[] = []
      for (const api of ['webgl', 'webgpu'] as const) {
        const b = backends[api]; if (!b) continue
        const before = tick === 0 ? input.points : (await b.read()).positions
        b.step(); const actual = await b.read(); const checks = compare(actual, reference(input, before), before)
        const trajectory = compareArray(actual.positions, cpu, input.points)
        for (const c of [...Object.values(checks).filter((c): c is ReturnType<typeof compareArray> => typeof c === 'object'), trajectory]) {
          if (c.valid) passed++; else failed++
        }
        rows.push(`<tr><td>${api}</td>${[checks.forces, checks.positions, trajectory]
          .map(c => `<td>${c.valid ? 'Pass' : `Fail (${c.failures})`}</td>`).join('')}</tr>`)
      }
      tick++; draw()
      output.innerHTML = `<table><caption>Tick ${tick} · existing numerical gates</caption><thead><tr><th>Backend</th>
        <th>Force</th><th>Position</th><th>Independent trajectory</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    } catch (e) { error = String(e); status.textContent = error } finally { busy = false; controls() }
  }
  const animate = (): void => {
    if (!running || destroyed) return
    try { Object.values(backends).forEach(b => b.step()); cpu = reference(input, cpu).positions; tick++; draw(); frame = requestAnimationFrame(animate) } catch (e) { error = String(e); stop(); status.textContent = error }
  }
  const showReport = (): void => {
    if (!report) return
    const rows = report.plan.cases.flatMap(c => (['webgl', 'webgpu'] as const).map(api => {
      const name = `${c.kind}/${c.count}`; const checks = report!.checks.filter(r => r.case === name && r.api === api)
      const times = report!.timings.filter(r => r.case === name && r.api === api && !r.warmup)
      const validTimes = times.length === 7 && times.every(t => t.measurement.timerStatus === 'valid' && t.measurement.batchGpuMs !== null)
      const pass = checks.filter(rowAccepted).length
      return `<tr><td>${name}</td><td>${api}</td><td>${checks.length ? `${pass}/${checks.length} pass` : 'Unchecked'}</td>
        <td>${validTimes ? `${(median(times.map(t => t.measurement.batchGpuMs! / t.measurement.operations))).toFixed(4)} ms` : 'Unavailable'}</td></tr>`
    }))
    studyOutput.innerHTML = `<p>${report.status} · cost is descriptive, including for rejected controls.</p>
      <p>Shared-input WebGPU/WebGL: ${report.pairs.filter(p => p.checks.valid).length}/${report.pairs.length} pass.
      Post-timing forces and unchanged positions: ${report.postTiming.filter(p => p.checks.valid).length}/${report.postTiming.length} pass.</p>
      <table><thead><tr><th>Input</th><th>Backend</th>
      <th>Checkpoints + updates</th><th>Force GPU median</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    for (const message of report.errors) { const p = document.createElement('p'); p.textContent = message; studyOutput.append(p) }
  }
  const study = async (): Promise<void> => {
    stop(); busy = true; cancelled = false; controls(); Object.values(backends).forEach(b => b.destroy()); backends = {}; report = createReport()
    await runStudy(canvases, message => { status.textContent = message }, () => cancelled || destroyed, report)
    if (destroyed) return
    const result = report.status; showReport(); await initialize(); status.textContent = `Study ${result}. Results and export retained below. Live preview reset.`
    const gates = [...report.checks.map(rowAccepted),
      ...report.pairs.map(c => c.checks.valid), ...report.postTiming.map(c => c.checks.valid)]
    passed = gates.filter(Boolean).length; failed = gates.length - passed
    error = report.errors.join('; ') || error
  }
  const click = (event: Event): void => {
    const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]')?.dataset.action
    if (action === 'stop') stop()
    if (busy || running || destroyed) return
    if (action === 'step') step()
    if (action === 'reset') initialize()
    if (action === 'run' && Object.keys(backends).length === 2) { running = true; controls(); animate() }
    if (action === 'study') study()
    if (action === 'export' && report) {
      const blob = new Blob([JSON.stringify(report, (_, v: unknown) => ArrayBuffer.isView(v) ? Array.from(v as Float32Array) : v, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'point-attractors.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
  const change = (): void => { initialize() }
  host.addEventListener('click', click); host.addEventListener('change', change)
  mountRunLayout(host, () => ({
    state: busy ? 'Working' : running ? `Running · tick ${tick}` : `Paused · tick ${tick}`,
    passed: passed ? `${passed} named checks` : 'No checks yet',
    failed: error || (failed ? `${failed} failed checks` : 'None recorded'),
    unchecked: 'Unsampled ticks; combined forces; complete frame cost; production integration',
  }),
  { experiment: 'point-attractors', visualFirst: true, devices: () => Object.values(backends).map(b => b.info) })
  compactRunControls(host, { diagnostics: true })
  await initialize()
  return {
    pause: stop,
    destroy (): void {
      destroyed = true; stop(); disposeRunLayout(host); host.removeEventListener('click', click); host.removeEventListener('change', change)
      Object.values(backends).forEach(b => b.destroy()); backends = {}; host.replaceChildren()
    },
  }
}
