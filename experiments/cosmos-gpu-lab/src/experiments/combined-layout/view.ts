import type { ExperimentInstance } from '../../runtime/experiment'
import { fitView } from '../many-body/backend'
import { TOLERANCE as repulsionTolerance } from '../many-body/reference'
import { TOLERANCE as springTolerance } from '../weighted-links/reference'
import { benchmarkSprings, type SpringTimingRow } from './spring-benchmark'
import { compareSpringPrecision, type SpringStudyRow } from './spring-study'
import { PRECISION_MODES, PRECISION_LABELS, GRAVITY, REPULSION, SPRINGS, type Fixture, type SpringPrecision } from './data'
import { BACKENDS, LABELS, createCombinedSession, type CombinedSession, type Name, type Row } from './session'
const num = (v: number): string => Number.isFinite(v) ? v.toExponential(2) : 'non-finite'
export async function createCombinedView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<p class="demo-note">Gravity → integrate → repulsion → integrate → incoming springs → integrate → outgoing springs → integrate → cool.
    Each backend evolves independently. The alpha = 1 probe tests whether a cooled layout still moves when forces regain full strength.</p>
    <div class="scale-toolbar">
      <label>Graph <select data-control="fixture">${['chain', 'star', 'communities', 'pinned'].map(f => `<option>${f}</option>`).join('')}</select></label>
      <label>Points <select data-control="count"><option>32</option><option selected>128</option><option>512</option><option>2048</option></select></label>
      <label>Cooling schedule <select data-control="decay"><option value="100">100 ticks</option><option value="300">300 ticks</option></select></label>
      <label>Validation <select data-control="checkpoint"><option value="10">Every 10 ticks + first / final</option>
        <option value="1">Every tick · diagnostic</option></select></label>
      <label>WebGPU spring arithmetic <select data-control="precision">${PRECISION_MODES.map(mode =>
    `<option value="${mode}">${PRECISION_LABELS[mode]}</option>`).join('')}</select></label>
    </div>
    <p class="demo-note">Precision candidates use luma's integer-controlled arithmetic for selected spring operations.
      Production WebGL, gravity, repulsion and CPU arithmetic stay unchanged. Native f32 remains the baseline.</p>
    <p class="demo-note">Checkpoint mode checks all four stages and the whole tick at selected ticks only. Other ticks are unvalidated.
      CPU continues independently; bounds and final metrics still require readback. All force tolerances stay unchanged.</p>
    <div class="demo-toolbar playback-toolbar"><div class="controls"><button data-action="step">Step + validate</button>
      <button data-action="run" class="button-primary">Run cooling schedule</button><button data-action="stop" disabled>Stop</button>
      <button data-action="probe">Probe at α = 1</button>
      <button data-action="replay" disabled>Replay first failures</button>
      <button data-action="precision-study" disabled>Compare spring rounding</button>
      <button data-action="spring-timing">Time spring arithmetic</button>
      <button data-action="reset">Reset / retry</button><button data-action="export" disabled>Export JSON</button></div>
      <span class="tick-counter">Tick <strong data-output="tick">0</strong> · α <strong data-output="alpha">1</strong></span></div>
    <p data-output="status" class="many-body-status" role="status">Preparing combined simulation…</p>
    <section class="backend-panels many-body-panels">${[...BACKENDS, 'CPU' as const].map(name => `<article class="backend-panel">
      <div class="panel-heading"><h2>${LABELS[name]}</h2><span class="status" data-state="${name}">Starting</span></div>
      <canvas data-canvas="${name}" width="480" height="340" aria-label="${LABELS[name]} combined layout"></canvas>
      <p class="demo-note" data-info="${name}"></p></article>`).join('')}</section>
    <p class="demo-note">Shared camera; blue free points, orange pinned. GPU points and links use resident positions.
      Checkpoint sub-steps are read back for validation. This is a correctness and layout study, not an FPS benchmark.</p>
    <div data-output="results" class="many-body-results"></div><div data-output="probe" class="many-body-results"></div>
    <div data-output="captures" class="many-body-results"></div><div data-output="replay" class="many-body-results"></div>
    <div data-output="precision-study" class="many-body-results"></div>
    <div data-output="spring-timing" class="many-body-results"></div><div data-output="chart" class="trajectory-chart"></div>`
  const el = <T extends HTMLElement>(q: string): T => host.querySelector<T>(q)!
  const control = (name: string): HTMLSelectElement => el(`[data-control="${name}"]`)
  const canvas = (name: Name | 'CPU'): HTMLCanvasElement => el(`[data-canvas="${name}"]`)
  let session: CombinedSession | undefined; let probe: Row | undefined; let busy = false; let stopped = false; let destroyed = false
  let precisionStudy: SpringStudyRow[] = []; let springTimings: SpringTimingRow[] = []
  const status = el('[data-output="status"]')
  const controls = (): void => {
    host.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(c => { c.disabled = busy })
    el<HTMLButtonElement>('[data-action="stop"]').disabled = !busy
    el<HTMLButtonElement>('[data-action="export"]').disabled = busy || (!session?.rows.length && !probe && !springTimings.length)
    el<HTMLButtonElement>('[data-action="precision-study"]').disabled = busy || !session ||
      !Object.keys(session.firstFailures).some(k => k.endsWith('-incoming') || k.endsWith('-outgoing'))
    el<HTMLButtonElement>('[data-action="replay"]').disabled = busy || !session || !Object.keys(session.captures).length
    el<HTMLButtonElement>('[data-action="run"]').disabled = busy || !session || session.rows.length >= session.settings.decay
  }
  const checksTable = (row: Row): string => !row.checked
    ? '<p class="demo-note">This tick was not validated.</p>'
    : `<details><summary>Inspect stage and whole-tick checks</summary>
    <table><thead><tr><th>Backend / stage</th><th>Force failures</th><th>Position failures</th><th>Structure / centroids</th></tr></thead><tbody>
    ${row.results.map(r => `${r.stages.map(s => `<tr><td>${LABELS[r.name]} · ${s.stage}</td><td>${s.forces.failures}</td>
      <td>${s.positions.failures}</td>
      <td>${s.structure ? `${s.structure.valid ? 'Pass' : 'FAIL'} / ${s.centroidDifferences ?? 'not stored'}` : '—'}</td></tr>`).join('')
  }<tr><td>${LABELS[r.name]} · full tick from own starting positions</td><td>—</td><td>${r.wholeTick?.failures ?? '—'}</td><td>—</td></tr>`).join('')}
    </tbody></table></details>`
  const render = (): void => {
    if (!session || destroyed) return
    const row = session.rows.at(-1); const cpu = session.cpu(); const view = fitView([cpu, ...session.lanes.map(l => l.positions)])
    for (const lane of session.lanes) {
      if (!session.errors[lane.name]) {
        try { lane.backend.render(view) } catch (error) {
          session.errors[lane.name] = error instanceof Error ? error.message : String(error)
          if (row) row.complete = false
          if (probe) probe.complete = false
        }
      }
    }
    const c = canvas('CPU'); const ctx = c.getContext('2d')!
    const xy = (i: number): [number, number] => [((cpu[i] - view[0]) * view[2] + 1) * c.width / 2,
      (1 - (cpu[i + 1] - view[1]) * view[3]) * c.height / 2]
    ctx.fillStyle = '#13161b'; ctx.fillRect(0, 0, c.width, c.height); ctx.strokeStyle = '#455266'; ctx.lineWidth = 1; ctx.beginPath()
    for (let e = 0; e < session.graph.links.length; e += 2) {
      ctx.moveTo(...xy(session.graph.links[e] * 4)); ctx.lineTo(...xy(session.graph.links[e + 1] * 4))
    }
    ctx.stroke()
    for (let i = 0; i < cpu.length; i += 4) {
      ctx.fillStyle = cpu[i + 2] > 0.5 ? '#ffb866' : '#9fb5d5'; ctx.beginPath(); ctx.arc(...xy(i), 2.5, 0, Math.PI * 2); ctx.fill()
    }
    for (const name of BACKENDS) {
      const failures = session.rows.filter(r => r.results.some(c => c.name === name && c.valid === false)).length
      el(`[data-state="${name}"]`).textContent = session.errors[name]
        ? 'Unavailable / stopped'
        : failures
          ? `${failures} failed checkpoint${failures === 1 ? '' : 's'}`
          : row ? `${session.rows.filter(r => r.results.some(c => c.name === name && c.valid === true)).length} checkpoints pass` : 'Ready'
      el(`[data-info="${name}"]`).textContent = session.errors[name] ?? session.lanes.find(l => l.name === name)?.backend.info ?? ''
    }
    el('[data-state="CPU"]').textContent = 'Independent reference'
    el('[data-info="CPU"]').textContent = `${session.settings.count} points · ${session.graph.links.length / 2} weighted links · origin (0, 0)`
    el('[data-output="tick"]').textContent = String(session.rows.length); el('[data-output="alpha"]').textContent = num(session.alpha())
    if (row) {
      const summary = row.results.map(r => ({
        name: LABELS[r.name],
        m: r.metrics,
        drift: num(r.drift.rms),
        failed: session!.rows.filter(row => row.results.some(c => c.name === r.name && c.valid === false)).length,
      }))
      summary.push({ name: 'CPU', m: row.cpu, drift: '0', failed: 0 })
      el('[data-output="results"]').innerHTML = `<table><caption>Tick ${row.tick} · used α = ${num(row.alpha)}
        · ${row.checked ? 'validated checkpoint' : 'not validated'}</caption>
        <thead><tr><th>Path</th><th>RMS motion</th><th>Link-length error</th><th>RMS radius</th>
          <th>RMS drift vs CPU</th><th>Failed checkpoints</th></tr></thead>
        <tbody>${summary.map(r => `<tr><td>${r.name}</td><td>${num(r.m.motion.rms)}</td><td>${num(r.m.linkError)}</td>
          <td>${num(r.m.shape.radius)}</td><td>${r.drift}</td><td>${r.failed}</td></tr>`).join('')}</tbody></table>
        <p class="demo-note">Link-length error = RMS((edge length − 10) / 10). Repulsion and gravity compete with springs;
          zero link error is not the expected equilibrium. Cooling reduces motion even without equilibrium.</p>${checksTable(row)}`
    } else el('[data-output="results"]').replaceChildren()
    el('[data-output="probe"]').innerHTML = probe
      ? `<h3>Full-strength probe · layout after tick ${session.rows.length}</h3>
      <p class="demo-note">One diagnostic tick at α = 1, then restore all original positions. Cooling and trajectory are unchanged.</p>
      <table><thead><tr><th>Path</th><th>Probe RMS / max motion</th><th>Checks</th></tr></thead><tbody>
      ${probe.results.map(r => `<tr><td>${LABELS[r.name]}</td><td>${num(r.metrics.motion.rms)} / ${num(r.metrics.motion.max)}</td>
        <td>${r.valid ? 'Pass' : 'FAIL'}</td></tr>`).join('')}
      <tr><td>CPU</td><td>${num(probe.cpu.motion.rms)} / ${num(probe.cpu.motion.max)}</td><td>Reference</td></tr></tbody></table>${checksTable(probe)}`
      : ''
    const failed = session.rows.flatMap(row => row.results.filter(r => r.valid === false).map(r => ({ tick: row.tick, r })))
    el('[data-output="captures"]').innerHTML = Object.keys(session.captures).length
      ? `<h3>First captured failures</h3>
      <p class="demo-note">These checked ticks failed the original budget. Intermediate unchecked ticks may also fail.
        Replay preserves the current layout; export includes the captured inputs and outputs.</p>
      <table><thead><tr><th>Capture</th><th>Tick</th><th>α</th><th>Failed stages (force / position components)</th>
        <th>Whole-tick position failures</th></tr></thead><tbody>
      ${Object.entries(session.captures).map(([key, c]) => `<tr><td>${key}</td><td>${c.tick}</td><td>${num(c.alpha)}</td>
        <td>${c.checks.stages.filter(s => !s.valid).map(s => `${s.stage}: ${s.forces.failures} / ${s.positions.failures}` +
          `${s.structure && !s.structure.valid ? ' · structure FAIL' : ''}${s.centroidDifferences ? ' · centroid FAIL' : ''}`).join('; ') || 'None'}</td>
        <td>${c.checks.wholeTick?.failures ?? '—'}</td></tr>`).join('')}</tbody></table>
      <details><summary>All failed checkpoints (${failed.length} backend results)</summary>
      <table><thead><tr><th>Tick</th><th>Backend</th><th>Failed stages (force / position)</th><th>Whole-tick failures</th></tr></thead><tbody>
      ${failed.map(({ tick, r }) => `<tr><td>${tick}</td><td>${LABELS[r.name]}</td>
        <td>${r.stages.filter(s => !s.valid).map(s => `${s.stage}: ${s.forces.failures} / ${s.positions.failures}` +
          `${s.structure && !s.structure.valid ? ' · structure FAIL' : ''}${s.centroidDifferences ? ' · centroid FAIL' : ''}`).join('; ') || 'None'}</td>
        <td>${r.wholeTick?.failures ?? '—'}</td></tr>`).join('')}</tbody></table></details>`
      : ''
    el('[data-output="replay"]').innerHTML = session.replays.length
      ? `<h3>Failure replay</h3>
      <p class="demo-note">First captured failure per backend (and probe). Replayed with the original positions, alpha and tick seed.
        Reproduced requires identical check results and bit-identical final positions; it does not make a failing tick pass.</p>
      <table><thead><tr><th>Capture</th><th>Tick</th><th>Outcome</th><th>Changed output components</th><th>Restored</th></tr></thead><tbody>
      ${session.replays.map(r => `<tr><td>${r.key}</td><td>${r.tick}</td><td>${r.error ? 'Replay error' : r.reproduced ? 'Reproduced' : 'Not reproduced'}</td>
        <td>${r.differingComponents ?? '—'}</td><td>${r.restored ? 'Yes' : 'NO'}</td></tr>`).join('')}</tbody></table>`
      : ''
    el('[data-output="precision-study"]').innerHTML = precisionStudy.length
      ? `<h3>Frozen spring-input comparison</h3>
      <p class="demo-note">All six WebGPU modes use the same captured stage inputs and CPU expectations.
        Separate devices leave the current layout unchanged. This isolates arithmetic; it is not a trajectory or timing result.</p>
      <table><thead><tr><th>Mode</th><th>Capture / tick</th><th>Force failures</th><th>Position failures</th><th>Max position error</th></tr></thead><tbody>
      ${precisionStudy.map(r => `<tr><td>${PRECISION_LABELS[r.mode]}</td><td>${r.capture} / ${r.tick}</td>
        <td>${r.error ? 'Error (see export)' : r.forces?.failures}</td><td>${r.positions?.failures ?? '—'}</td>
        <td>${r.positions ? num(r.positions.maxError) : '—'}</td></tr>`).join('')}</tbody></table>`
      : ''
    el('[data-output="spring-timing"]').innerHTML = springTimings.length
      ? `<h3>Spring GPU timing · fixed initial CPU inputs</h3>
      <p class="demo-note">Same ${session.settings.fixture} / ${session.settings.count} inputs for every mode at α = 1.
        Each batch repeats one directional spring evaluation; it does not advance a layout.
        GPU medians and min–max ranges exclude upload, compilation, readback and validation. CPU completion is separate.
        Two warmups, seven samples; rotated mode order. A failed check remains FAIL regardless of speed.
        Small batches can approach timestamp resolution; compare ranges, not just medians.</p>
      <table><thead><tr><th>Direction / work</th><th>Mode</th><th>Batch × samples</th><th>GPU µs / operation (range)</th>
        <th>CPU completion µs / operation</th><th>Checks</th></tr></thead><tbody>
      ${springTimings.map(r => {
    const gpu = r.summary?.gpuMs; const range = r.summary?.gpuRange
    const valid = r.checks.length && r.checks.every(c => c.forces.valid && c.positions.valid)
    return `<tr><td>${r.stage} / ${r.phase === 'force' ? 'force' : 'force + integrate'}</td><td>${PRECISION_LABELS[r.mode]}</td>
      <td>${r.operations} × ${r.samples.length}</td><td>${gpu == null
  ? 'Unavailable / incomplete'
  : `${(gpu * 1000).toFixed(2)} (${range!.map(v => (v * 1000).toFixed(2)).join('–')})`}</td>
      <td>${r.summary ? (r.summary.completionMs * 1000).toFixed(2) : '—'}</td>
      <td>${r.error ? 'Error (see export)' : !r.checks.length ? 'Not checked' : !valid ? 'FAIL' : r.samples.length === 7 ? 'Pass' : 'Partial'}</td></tr>`
  }).join('')}</tbody></table>`
      : ''
    if (!row) { el('[data-output="chart"]').replaceChildren(); return }
    const charts = [
      { title: 'RMS motion per tick', get: (m: Row['cpu']) => m.motion.rms },
      { title: 'Normalized link-length error', get: (m: Row['cpu']) => m.linkError },
    ]
    const colors = { webgl: '#e7b882', webgpu: '#9fb5d5', CPU: '#c7b1e0' }
    el('[data-output="chart"]').innerHTML = `${charts.map(chart => {
      const values = session!.rows.flatMap(r => [chart.get(r.cpu), ...r.results.map(c => chart.get(c.metrics))]).filter(Number.isFinite)
      const max = Math.max(1e-12, ...values)
      return `<h3>${chart.title}</h3><svg viewBox="0 0 720 185" role="img" aria-label="${chart.title} over ${row.tick} ticks">
        <path d="M50 20 V150 H690" stroke="currentColor" opacity="0.4" fill="none"/>
        <text x="50" y="14" fill="currentColor" font-size="12">${num(max)}</text><text x="30" y="154" fill="currentColor" font-size="12">0</text>
        <text x="50" y="175" fill="currentColor" font-size="12">Tick 1</text><text x="630" y="175" fill="currentColor" font-size="12">Tick ${row.tick}</text>
        ${[...BACKENDS, 'CPU' as const].map(name => {
    const points = session!.rows.flatMap(r => {
      const m = name === 'CPU' ? r.cpu : r.results.find(c => c.name === name)?.metrics
      return m && Number.isFinite(chart.get(m)) ? [`${50 + (r.tick - 1) / Math.max(1, row.tick - 1) * 640},${150 - chart.get(m) / max * 125}`] : []
    })
    return `<polyline points="${points.join(' ')}" fill="none" stroke="${colors[name]}" stroke-width="2"/>`
  }).join('')}</svg>`
    }).join('')}<p>${[...BACKENDS, 'CPU' as const].map(n => `<span style="color:${colors[n]}">${LABELS[n]}</span>`).join(' · ')}</p>`
  }
  const setup = async (): Promise<void> => {
    session?.destroy(); session = undefined; probe = undefined; precisionStudy = []; springTimings = []; status.textContent = 'Preparing combined simulation…'
    for (const name of BACKENDS) { const old = canvas(name); old.replaceWith(old.cloneNode()) }
    const next = await createCombinedSession({
      fixture: control('fixture').value as Fixture,
      count: Number(control('count').value),
      decay: Number(control('decay').value),
      checkpointEvery: Number(control('checkpoint').value),
      springPrecision: control('precision').value as SpringPrecision,
    }, canvas)
    if (destroyed) { next.destroy(); return }
    session = next; render()
    status.textContent = Object.keys(next.errors).length ? 'Partial comparison; see unavailable backend.' : 'Ready. Run the cooling schedule.'
  }
  const task = async (work: () => Promise<void>): Promise<void> => {
    if (busy || destroyed) return
    busy = true; stopped = false; controls()
    try { await work() } catch (error) {
      if (!destroyed) status.textContent = error instanceof Error ? error.message : String(error)
    } finally { busy = false; if (!destroyed) controls() }
  }
  const run = async (ticks: number, forceCheck = false): Promise<void> => {
    if (!session) return
    probe = undefined
    const panels = el('.backend-panels'); panels.style.scrollMarginTop = `${el('.playback-toolbar').offsetHeight + 16}px`
    panels.scrollIntoView({ behavior: 'smooth', block: 'start' })
    for (let i = 0; i < ticks; i++) {
      if (destroyed || stopped) break
      status.textContent = `Checking tick ${session.rows.length + 1} / ${session.settings.decay}…`
      await session.step(forceCheck); if (destroyed) return
      render(); await new Promise(resolve => setTimeout(resolve, 0))
    }
    if (!destroyed) {
      status.textContent = `${stopped ? 'Stopped' : 'Finished'} at tick ${session.rows.length}; α = ${num(session.alpha())}. ` +
      `${Object.keys(session.errors).length ? 'Partial comparison. ' : ''}` +
      `${session.rows.some(r => r.results.some(c => c.valid === false))
        ? 'Checkpoint failures remain recorded. '
        : session.rows.some(r => r.results.some(c => c.valid === true))
          ? 'Completed checkpoints pass. Only ticks marked validated were checked. '
          : 'No GPU checks completed. '}` +
      'Use the α = 1 probe to distinguish cooling from force balance.'
    }
  }
  host.querySelectorAll('select').forEach(c => c.addEventListener('change', () => { task(setup) }))
  el('[data-action="step"]').addEventListener('click', () => { task(async () => { await run(1, true) }) })
  el('[data-action="run"]').addEventListener('click', () => {
    task(async () => { if (session) await run(Math.max(0, session.settings.decay - session.rows.length)) })
  })
  el('[data-action="stop"]').addEventListener('click', () => { stopped = true })
  el('[data-action="reset"]').addEventListener('click', () => { task(setup) })
  el('[data-action="probe"]').addEventListener('click', () => {
    task(async () => {
      if (!session) return
      status.textContent = 'Probing one tick at α = 1…'; probe = await session.probe()
      if (destroyed) return
      render(); status.textContent = probe.complete
        ? 'Probe finished; original positions restored. Read its motion and checks below.'
        : 'Partial probe; see backend errors.'
      el('[data-output="probe"]').scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  })
  el('[data-action="replay"]').addEventListener('click', () => {
    task(async () => {
      if (!session) return
      status.textContent = 'Replaying captured failures with full validation…'
      const reports = await session.replayFailures()
      if (destroyed) return
      render(); status.textContent = reports.every(r => r.restored)
        ? `Replayed ${reports.length} captures; ${reports.filter(r => r.reproduced).length} reproduced. Original layout and cooling restored.`
        : 'Replay incomplete; see backend errors and export details.'
      el('[data-output="replay"]').scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  })
  el('[data-action="precision-study"]').addEventListener('click', () => {
    task(async () => {
      if (!session) return
      status.textContent = 'Comparing six WebGPU arithmetic modes on captured spring inputs…'
      precisionStudy = await compareSpringPrecision(session, () => stopped || destroyed)
      if (destroyed) return
      render(); status.textContent = precisionStudy.some(r => r.error)
        ? 'Precision comparison incomplete; inspect export errors.'
        : `${stopped ? 'Precision comparison stopped' : 'Precision comparison finished'}. Current layout and cooling unchanged.`
      el('[data-output="precision-study"]').scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  })
  el('[data-action="spring-timing"]').addEventListener('click', () => {
    task(async () => {
      if (!session) return
      springTimings = []
      await benchmarkSprings({
        settings: session.settings,
        rows: springTimings,
        cancelled: () => stopped || destroyed,
        progress: message => { if (!destroyed) status.textContent = message },
      })
      if (destroyed) return
      render(); status.textContent = `${stopped ? 'Timing stopped; partial results retained' : 'Timing finished'}. Inspect checks and timer ranges below.`
      el('[data-output="spring-timing"]').scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  })
  el('[data-action="export"]').addEventListener('click', () => {
    if (!session) return
    const json = JSON.stringify({
      schemaVersion: 2,
      experiment: 'combined-layout',
      recordedAt: new Date().toISOString(),
      browser: navigator.userAgent,
      settings: session.settings,
      parameters: { gravity: GRAVITY, repulsion: REPULSION, springs: SPRINGS },
      tolerances: { repulsionTolerance, springTolerance },
      rows: session.rows,
      probe,
      errors: session.errors,
      firstFailures: session.firstFailures,
      firstTickFailures: session.firstTickFailures,
      captures: session.captures,
      replays: session.replays,
      precisionStudy,
      springTimings,
      devices: Object.fromEntries(session.lanes.map(l => [l.name, l.backend.info])),
    }, (_key, value) => ArrayBuffer.isView(value)
      ? Array.from(value as Float32Array)
      : typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const a = document.createElement('a')
    a.href = url; a.download = 'cosmos-combined-layout.json'; a.click(); URL.revokeObjectURL(url)
  })
  await task(setup)
  return { destroy (): void { destroyed = true; stopped = true; session?.destroy() } }
}
