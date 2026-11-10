import type { ExperimentInstance } from '../../runtime/experiment'
import { fitView } from '../many-body/backend'
import { PARAMETERS, type Fixture } from '../many-body/data'
import { TOLERANCE } from '../many-body/reference'
import { createTrajectorySession, LANES, LABELS, type Lane, type TrajectorySession } from './session'
const number = (v: number): string => Number.isFinite(v) ? v.toExponential(2) : 'non-finite'
const colors = { webgl: '#e7b882', materialized: '#9fb5d5', streamed: '#c7b1e0' }
export async function createTrajectories (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<p class="demo-note">Each path keeps its own positions and bounds. Every GPU tick is checked against CPU arithmetic on that path's input.
    Position drift is reported separately. Repulsion alone expands the layout; springs, gravity and cooling are not active.</p>
    <div class="scale-toolbar">
      <label>Fixture <select data-control="fixture">
        ${['uniform', 'clusters', 'coincident', 'edge-cases', 'boundary'].map(f => `<option>${f}</option>`).join('')}</select></label>
      <label>Points <select data-control="count">
        ${[8, 65, 512, 8192, 16384].map(n => `<option ${n === 512 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Samples per cell <select data-control="slots"><option>2</option><option selected>8</option><option>16</option></select></label>
      <label>Quality <select data-control="quality"><option value="precise">Precise</option><option value="balanced">Balanced</option></select></label>
    </div>
    <div class="demo-toolbar playback-toolbar"><div class="controls">
      <button data-action="step">Step + validate</button><button class="button-primary" data-action="run">Run 20 ticks</button>
      <button data-action="stop" disabled>Stop</button><button data-action="reset">Reset / retry devices</button>
      <button data-action="export" disabled>Export JSON</button></div><span class="tick-counter">Tick <strong data-output="tick">0</strong></span></div>
    <p role="status" class="many-body-status" data-output="status">Preparing independent paths…</p>
    <section class="backend-panels trajectory-panels">${[...LANES, 'CPU' as const].map(name => `<article class="backend-panel">
      <div class="panel-heading"><h2>${LABELS[name]}</h2><span class="status" data-state="${name}">Starting</span></div>
      <canvas data-canvas="${name}" width="480" height="340" aria-label="${LABELS[name]} independent positions"></canvas>
      <p class="demo-note" data-info="${name}"></p></article>`).join('')}</section>
    <p class="demo-note">All panels use the same camera. GPU panels draw their resident resources; CPU uses Canvas 2D.
      Readback and CPU checks run every tick: this is a validation experiment, not a performance test.</p>
    <div data-output="results" class="many-body-results"></div>
    <div data-output="chart" class="trajectory-chart"></div>`
  const el = <T extends HTMLElement>(q: string): T => host.querySelector<T>(q)!
  const control = (key: string): HTMLSelectElement => el(`[data-control="${key}"]`)
  const canvas = (name: Lane | 'CPU'): HTMLCanvasElement => el(`[data-canvas="${name}"]`)
  let session: TrajectorySession | undefined; let busy = false; let stopped = false; let destroyed = false
  const status = el('[data-output="status"]')
  const controls = (): void => {
    host.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(c => { c.disabled = busy })
    el<HTMLButtonElement>('[data-action="stop"]').disabled = !busy
    el<HTMLButtonElement>('[data-action="export"]').disabled = busy || !session?.rows.length
    control('count').disabled = busy || ['edge-cases', 'boundary'].includes(control('fixture').value)
  }
  const render = (): void => {
    if (!session || destroyed) return
    const row = session.rows.at(-1); const cpu = session.cpu(); const view = fitView([cpu, ...session.lanes.map(l => l.positions)])
    for (const lane of session.lanes) {
      if (!session.errors[lane.name]) {
        try { lane.backend.render(view) } catch (error) {
          session.errors[lane.name] = error instanceof Error ? error.message : String(error)
          if (row) { row.errors[lane.name] = session.errors[lane.name]; row.complete = false }
        }
      }
    }
    const c = canvas('CPU'); const ctx = c.getContext('2d')!
    ctx.fillStyle = '#13161b'; ctx.fillRect(0, 0, c.width, c.height)
    for (let i = 0; i < cpu.length; i += 4) {
      if (cpu[i + 3] > 0.5) continue
      ctx.fillStyle = cpu[i + 2] > 0.5 ? '#ffb866' : '#9fb5d5'
      ctx.beginPath()
      ctx.arc(((cpu[i] - view[0]) * view[2] + 1) * c.width / 2,
        (1 - (cpu[i + 1] - view[1]) * view[3]) * c.height / 2, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const name of LANES) {
      const failures = session.rows.filter(r => r.checks.some(c => c.name === name && !c.valid)).length
      el(`[data-state="${name}"]`).textContent = session.errors[name]
        ? 'Unavailable / stopped'
        : failures ? `${failures} failed ticks` : row ? 'Local checks pass' : 'Ready'
      el(`[data-info="${name}"]`).textContent = session.errors[name] ??
        `${session.lanes.find(l => l.name === name)?.backend.info ?? ''}` +
        `${session.firstFailures[name] ? ` · first mismatch: tick ${session.firstFailures[name]!.tick}` : ''}`
    }
    el('[data-state="CPU"]').textContent = row ? 'Independent path' : 'Ready'
    el('[data-info="CPU"]').textContent = `${session.settings.count} points · float32 hierarchy reference`
    el('[data-output="tick"]').textContent = String(session.rows.length)
    if (!row) { el('[data-output="results"]').replaceChildren(); el('[data-output="chart"]').replaceChildren(); return }
    el('[data-output="results"]').innerHTML = `<table><caption>Tick ${row.tick} · strict local checks and independent-path drift</caption>
      <thead><tr><th>Path</th><th>Local check</th><th>Failed ticks / checked</th><th>RMS / max drift vs CPU</th>
      <th>RMS motion</th><th>RMS radius</th><th>Different cells</th></tr></thead>
      <tbody>${row.checks.map(check => `<tr><td>${LABELS[check.name]}</td><td>${check.valid ? 'Pass' : 'FAIL'}</td>
        <td>${session!.rows.filter(r => r.checks.some(c => c.name === check.name && !c.valid)).length} /
          ${session!.rows.filter(r => r.checks.some(c => c.name === check.name)).length}</td>
        <td>${number(check.drift.rms)} / ${number(check.drift.max)}</td><td>${number(check.motion.rms)}</td>
        <td>${number(check.shape.radius)}</td><td>${check.cellDifferences}</td></tr>`).join('')}
      <tr><td>CPU</td><td>Reference</td><td>—</td><td>0</td><td>${number(row.cpu.motion.rms)}</td>
      <td>${number(row.cpu.shape.radius)}</td><td>—</td></tr></tbody></table>
      <p class="demo-note">Full-buffer vs streamed position drift:
      ${row.correctedDrift ? `${number(row.correctedDrift.rms)} RMS / ${number(row.correctedDrift.max)} max` : 'unavailable'}.
      Drift and cell differences have no quality pass/fail threshold. Different cells counts input points assigned to a different finest cell
      than the CPU path, using each path's own bounds.</p>
      <details><summary>Inspect latest local checks</summary><table><thead><tr><th>Path</th><th>Force failures</th><th>Position failures</th>
      <th>Structure</th><th>Integration</th><th>Centroid bit differences</th></tr></thead><tbody>${row.checks.map(c => `<tr><td>${LABELS[c.name]}</td>
      <td>${c.output.forces.failures}</td><td>${c.output.positions.failures}</td><td>${c.structure.valid ? 'Pass' : 'FAIL'}</td>
      <td>${c.integration.valid ? 'Pass' : 'FAIL'}</td><td>${c.centroidDifferences ?? 'not stored'}</td></tr>`).join('')}</tbody></table></details>`
    const all = session.rows.flatMap(r => r.checks.map(c => c.drift.rms)).filter(Number.isFinite)
    const max = Math.max(1e-12, ...all)
    const x = (tick: number): number => 50 + (tick - 1) / Math.max(1, session!.rows.length - 1) * 640
    const y = (value: number): number => 170 - value / max * 140
    el('[data-output="chart"]').innerHTML = `<h3>Position drift over time</h3>
      <p class="demo-note">RMS distance from the independent CPU path, in world units. Linear scale; no convergence verdict.</p>
      <svg viewBox="0 0 720 205" role="img" aria-label="Independent position drift over ${row.tick} ticks">
      <path d="M50 25 V170 H690" fill="none" stroke="currentColor" opacity="0.4"/>
      <text x="50" y="17" fill="currentColor" font-size="12">${number(max)}</text>
      <text x="30" y="174" fill="currentColor" font-size="12">0</text><text x="50" y="195" fill="currentColor" font-size="12">Tick 1</text>
      <text x="640" y="195" fill="currentColor" font-size="12">Tick ${row.tick}</text>
      ${LANES.map(name => {
    const points = session!.rows.flatMap(r => {
      const c = r.checks.find(c => c.name === name)
      return c && Number.isFinite(c.drift.rms) ? [`${x(r.tick)},${y(c.drift.rms)}`] : []
    })
    return `<polyline points="${points.join(' ')}" fill="none" stroke="${colors[name]}" stroke-width="2"/>`
  }).join('')}</svg><p>${LANES.map(name => `<span style="color:${colors[name]}">${LABELS[name]}</span>`).join(' · ')}</p>`
  }
  const setup = async (): Promise<void> => {
    session?.destroy(); session = undefined; status.textContent = 'Preparing independent paths…'
    for (const name of LANES) { const old = canvas(name); old.replaceWith(old.cloneNode()) }
    const next = await createTrajectorySession({
      fixture: control('fixture').value as Fixture,
      count: Number(control('count').value),
      slots: Number(control('slots').value),
      precise: control('quality').value === 'precise',
    }, canvas)
    if (destroyed) { next.destroy(); return }
    session = next; control('count').value = String(next.settings.count); render()
    status.textContent = Object.keys(next.errors).length
      ? 'Partial comparison: a backend is unavailable. Available paths can still run.'
      : 'Ready. Run 20 ticks to observe independent motion and drift.'
  }
  const task = async (fn: () => Promise<void>): Promise<void> => {
    if (busy || destroyed) return
    busy = true; stopped = false; controls()
    try { await fn() } catch (error) {
      if (!destroyed) status.textContent = error instanceof Error ? error.message : String(error)
    } finally { busy = false; if (!destroyed) controls() }
  }
  const run = async (ticks: number): Promise<void> => {
    if (!session) return
    const panels = el('.trajectory-panels')
    panels.style.scrollMarginTop = `${el('.playback-toolbar').offsetHeight + 16}px`
    panels.scrollIntoView({ behavior: 'smooth', block: 'start' })
    for (let i = 0; i < ticks; i++) {
      if (stopped || destroyed) break
      status.textContent = `Checking independent tick ${session.rows.length + 1}…`
      await session.step(); if (destroyed) return
      render(); await new Promise(resolve => setTimeout(resolve, 0))
    }
    if (destroyed) return
    const failed = session.rows.some(r => r.checks.some(c => !c.valid))
    status.textContent = `${stopped ? 'Stopped' : 'Finished'} at tick ${session.rows.length}. ` +
      `${Object.keys(session.errors).length ? 'Partial comparison; see stopped paths. ' : ''}` +
      `${failed
        ? 'Local-check failures recorded; drift does not excuse them.'
        : session.rows.some(r => r.checks.length) ? 'All completed local checks pass; drift is reported separately.' : 'No GPU checks completed.'}`
  }
  host.querySelectorAll('select').forEach(c => c.addEventListener('change', () => { task(setup) }))
  el('[data-action="step"]').addEventListener('click', () => { task(async () => { await run(1) }) })
  el('[data-action="run"]').addEventListener('click', () => { task(async () => { await run(20) }) })
  el('[data-action="reset"]').addEventListener('click', () => { task(setup) })
  el('[data-action="stop"]').addEventListener('click', () => { stopped = true })
  el('[data-action="export"]').addEventListener('click', () => {
    if (!session) return
    const blob = new Blob([JSON.stringify({
      schemaVersion: 1,
      experiment: 'repulsion-trajectories',
      recordedAt: new Date().toISOString(),
      browser: navigator.userAgent,
      settings: session.settings,
      parameters: PARAMETERS,
      tolerance: TOLERANCE,
      devices: Object.fromEntries(session.lanes.map(l => [l.name, l.backend.info])),
      rows: session.rows,
      errors: session.errors,
      firstFailures: session.firstFailures,
    }, (_key, value) => ArrayBuffer.isView(value)
      ? Array.from(value as Float32Array)
      : typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'cosmos-repulsion-trajectories.json'
    a.click(); URL.revokeObjectURL(url)
  })
  await task(setup)
  return { destroy (): void { destroyed = true; stopped = true; session?.destroy() } }
}
