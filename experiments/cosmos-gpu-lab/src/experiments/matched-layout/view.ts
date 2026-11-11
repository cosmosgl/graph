import type { ExperimentInstance } from '../../runtime/experiment'
import { PRESETS, type ProductionPreset } from '../combined-layout/production-settings'
import { sharedView } from './metrics'
import { createMatchedSession, LABELS, NAMES, type MatchedSession, type Name, type Row, type Settings } from './session'
function num (value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return Number.isFinite(value) ? value.toExponential(3) : 'non-finite'
}
const COLORS = { webgl: '#e7b882', webgpu: '#9fb5d5', cpu: '#c7b1e0' }
function settingsNote (settings: Settings): string {
  return settings.preset === 'adaptive' ? 'Shared CPU-derived sample decisions every 30 ticks (grid mode only).' : 'Fixed sample count.'
}
export async function createMatchedView (host: HTMLElement): Promise<ExperimentInstance> {
  const presets = Object.entries(PRESETS).map(([key, title]) =>
    `<option value="${key}"${key === 'adaptive' ? ' selected' : ''}>${title}</option>`).join('')
  host.innerHTML = `<p class="demo-note">Three independent layouts, one initial graph and random-sample schedule.
    Numerical checks replay a common CPU starting state, then restore the live GPU layouts. Quality metrics never change the tolerance.</p>
    <div class="scale-toolbar">
      <label>Graph <select data-control="fixture"><option>chain</option><option>communities</option><option>star</option></select></label>
      <label>Points <select data-control="count"><option selected>128</option><option>512</option>
        <option>4096</option><option>4097</option><option>8192</option></select></label>
      <label>Distribution <select data-control="distribution"><option>uniform</option><option>clusters</option></select></label>
      <label>Cooling <select data-control="ticks"><option>100</option><option>300</option><option>5000</option></select></label>
      <label>Force settings <select data-control="preset">${presets}</select></label>
      <label>Anchor <select data-control="pinned"><option value="true">Pin point 0</option><option value="false">Unpinned</option></select></label>
    </div>
    <div class="demo-toolbar playback-toolbar"><div class="controls">
      <button data-action="step">Step + check</button><button data-action="run" class="button-primary">Run comparison</button>
      <button data-action="stop" disabled>Stop</button><button data-action="probe">Probe at α = 1</button>
      <button data-action="replay" disabled>Replay failures</button><button data-action="reset">Reset</button>
      <button data-action="export" disabled>Export JSON</button>
    </div><span class="tick-counter">Tick <strong data-output="tick">0</strong> · α <strong data-output="alpha">1</strong></span></div>
    <p role="status" data-output="status" class="many-body-status">Preparing devices…</p>
    <section class="simulation-preview"><div class="backend-panels many-body-panels">${NAMES.map(name => `<article class="backend-panel">
      <div class="panel-heading"><h2>${LABELS[name]}</h2><span class="status" data-state="${name}">Preparing</span></div>
      <canvas width="480" height="340" data-canvas="${name}" aria-label="${LABELS[name]} layout"></canvas>
      <p class="demo-note" data-info="${name}"></p></article>`).join('')}</div></section>
    <p class="demo-note" data-output="method"></p>
    <div data-output="quality" class="many-body-results"></div><div data-output="probe" class="many-body-results"></div>
    <div data-output="charts" class="trajectory-chart"></div><div data-output="checks" class="many-body-results"></div>
    <p class="demo-note">Read <a href="#/matched-layout/docs/method">the method and metric definitions</a> and
      <a href="#/matched-layout/docs/findings">measured findings</a>. This diagnostic includes CPU work and readbacks;
      it is not a runtime performance benchmark.</p>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const control = (name: string): HTMLSelectElement => el(`[data-control="${name}"]`)
  const canvas = (name: Name): HTMLCanvasElement => el(`[data-canvas="${name}"]`)
  const status = el('[data-output="status"]')
  let session: MatchedSession | undefined; let busy = false; let stopped = false; let destroyed = false
  const controls = (): void => {
    host.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(c => { c.disabled = busy })
    el<HTMLButtonElement>('[data-action="stop"]').disabled = !busy
    el<HTMLButtonElement>('[data-action="export"]').disabled = busy || !session?.report.rows.length
    el<HTMLButtonElement>('[data-action="replay"]').disabled = busy || !Object.keys(session?.report.captures ?? {}).length
    el<HTMLButtonElement>('[data-action="run"]').disabled = busy || !session || session.report.rows.length >= session.settings.ticks
    el<HTMLButtonElement>('[data-action="step"]').disabled = busy || !session || session.report.rows.length >= session.settings.ticks
    el<HTMLButtonElement>('[data-action="probe"]').disabled = busy || !session
  }
  const qualityTable = (row: Row, title: string): string => `<table><caption>${title}</caption>
    <thead><tr><th>Path</th><th>Fitted stress RMS</th><th>Spring mismatch</th><th>RMS motion</th>
      <th>RMS radius</th><th>Raw drift / radius</th><th>Aligned drift / radius</th></tr></thead>
    <tbody>${NAMES.map(name => {
    const q = row.quality[name]; const radius = row.quality.cpu?.shape.radius || 1
    return `<tr><td>${LABELS[name]}</td><td>${num(q?.stress.rms)}</td><td>${num(q?.springMismatch)}</td><td>${num(q?.motion.rms)}</td>
      <td>${num(q?.shape.radius)}</td><td>${num(q ? q.drift.rms / radius : undefined)}</td><td>${num(q ? q.alignedRms / radius : undefined)}</td></tr>`
  }).join('')}</tbody></table>`
  const render = (): void => {
    if (!session || destroyed) return
    const { report } = session; const row = report.rows.at(-1); const cpu = session.cpu()
    const view = sharedView([cpu, ...session.lanes.map(l => l.positions)])
    for (const lane of session.lanes) {
      if (!report.errors[lane.name]) {
        try { lane.backend.render(view) } catch (error) { report.errors[lane.name] = String(error); if (row) row.complete = false }
      }
    }
    const c = canvas('cpu'); const ctx = c.getContext('2d')!
    const xy = (id: number): [number, number] => [((cpu[id * 4] - view[0]) * view[2] + 1) * c.width / 2,
      (1 - (cpu[id * 4 + 1] - view[1]) * view[3]) * c.height / 2]
    ctx.fillStyle = '#13161b'; ctx.fillRect(0, 0, c.width, c.height); ctx.strokeStyle = '#455266'; ctx.lineWidth = 1; ctx.beginPath()
    for (let e = 0; e < session.graph.links.length; e += 2) {
      const a = session.graph.links[e]; const b = session.graph.links[e + 1]
      if (cpu[a * 4 + 3] > 0.5 || cpu[b * 4 + 3] > 0.5) continue
      ctx.moveTo(...xy(a)); ctx.lineTo(...xy(b))
    }
    ctx.stroke()
    for (let id = 0; id < cpu.length / 4; id++) {
      if (cpu[id * 4 + 3] <= 0.5) {
        ctx.fillStyle = cpu[id * 4 + 2] > 0.5 ? '#ffb866' : '#9fb5d5'; ctx.beginPath(); ctx.arc(...xy(id), 2.5, 0, Math.PI * 2); ctx.fill()
      }
    }
    for (const name of NAMES) {
      const failed = name === 'cpu' ? 0 : report.rows.filter(r => r.checks[name]?.valid === false).length
      el(`[data-state="${name}"]`).textContent = name === 'cpu'
        ? 'Independent reference'
        : report.errors[name]
          ? 'Unavailable / stopped'
          : failed ? `${failed} failed checks` : `${report.rows.filter(r => r.checks[name]?.valid).length} checkpoints pass`
      el(`[data-info="${name}"]`).textContent = name === 'cpu'
        ? 'Float32 scalar operations · Canvas2D preview'
        : report.errors[name] ?? report.devices[name] ?? ''
    }
    el('[data-output="tick"]').textContent = String(report.rows.length); el('[data-output="alpha"]').textContent = num(session.alpha())
    const method = report.method === 'exact' ? 'Exact all-pairs' : 'Hierarchical'
    const sampling = report.method === 'exact' ? 'all present neighbors' : `${row?.samples ?? report.parameters.samples} samples`
    el('[data-output="method"]').textContent = `${method} repulsion · ${sampling} · ` +
      `origin (2048, 2048) · shared camera · orange pinned. ${settingsNote(session.settings)} ` +
      'Frozen checks: first, every 10 ticks and final. Unchecked ticks have no numerical verdict.'
    el('[data-output="quality"]').innerHTML = row ? qualityTable(row, `Independent trajectories · tick ${row.tick}`) : ''
    el('[data-output="probe"]').innerHTML = report.probe ? qualityTable(report.probe, 'One full-strength diagnostic tick · original layouts restored') : ''
    const checkpoints = report.rows.filter(r => Object.keys(r.checks).length)
    const replaySummary = report.replays.map(r => {
      const result = r.reproduced ? 'reproduced' : 'NOT reproduced'; const restored = r.restored ? 'restored' : 'NOT restored'
      return `${LABELS[r.name]} ${result}, ${restored}`
    }).join(' · ')
    el('[data-output="checks"]').innerHTML = checkpoints.length
      ? `<h3>Frozen-input numerical checks</h3>
      <p class="demo-note">Both GPUs start each checked tick from the same CPU state. Local checks use each stage’s actual input;
        whole-tick checks use the uninterrupted CPU result. Every diagnostic restores the independent layout bit for bit.</p>
      <p>${(['webgl', 'webgpu'] as const).map(name => {
    const checked = checkpoints.flatMap(r => r.checks[name] ? [r.checks[name]!] : [])
    return `${LABELS[name]}: ${checked.filter(c => c.valid).length} / ${checked.length} pass, ${checked.filter(c => !c.valid).length} fail`
  }).join(' · ')}.</p>
      <details><summary>Inspect ${checkpoints.length} checkpoint ${checkpoints.length === 1 ? 'tick' : 'ticks'}
        ${report.probe ? ' and the full-strength probe' : ''}</summary>
      <table><thead><tr><th>Tick</th><th>Path</th><th>Verdict</th><th>Force / position failures</th><th>Whole-tick failures</th><th>Restored</th></tr></thead>
      <tbody>${[...checkpoints, ...(report.probe ? [report.probe] : [])].flatMap(r => (['webgl', 'webgpu'] as const).map(name => {
    const check = r.checks[name]
    return `<tr><td>${r === report.probe ? 'α = 1 probe' : r.tick}</td><td>${LABELS[name]}</td><td>${check ? check.valid ? 'Pass' : 'FAIL' : 'Unavailable'}</td>
      <td>${check
    ? check.stages.filter(s => !s.forces.valid || !s.positions.valid || !s.flagsExact).map(s =>
      `${s.stage}: ${s.forces.failures} / ${s.positions.failures}${s.flagsExact ? '' : ' · flags differ'}`).join('; ') || '0 / 0'
    : '—'}</td>
      <td>${check?.wholeTick.failures ?? '—'}</td><td>${check?.restored ? 'Yes' : '—'}</td></tr>`
  })).join('')}</tbody></table></details>
      ${Object.entries(report.captures).length
    ? `<p>First captured failures: ${Object.entries(report.captures).map(([name, c]) =>
      `${LABELS[name as Name]} at tick ${c.tick}`).join(' · ')}. Export includes the frozen inputs and outputs.</p>`
    : ''}
      ${replaySummary ? `<p>Failure replay: ${replaySummary}.</p>` : ''}`
      : ''
    const charts: Array<{ title: string; value: (q: NonNullable<Row['quality']['cpu']>) => number | null }> = [
      { title: 'Scale-fitted stress RMS', value: q => q.stress.rms },
      { title: 'Directional spring mismatch', value: q => q.springMismatch },
      { title: 'Motion / layout radius', value: q => q.normalizedMotion },
    ]
    el('[data-output="charts"]').innerHTML = row
      ? `<p>${NAMES.map(n => `<span style="color:${COLORS[n]}">${LABELS[n]}</span>`).join(' · ')}</p>${charts.map(chart => {
        const values = report.rows.flatMap(r => NAMES.flatMap(n => r.quality[n] ? [chart.value(r.quality[n]!)] : []))
          .filter((v): v is number => v !== null && Number.isFinite(v))
        const max = Math.max(1e-12, ...values)
        return `<h3>${chart.title}</h3><svg viewBox="0 0 720 170" role="img" aria-label="${chart.title} over ${row.tick} ticks">
        <path d="M60 20 V135 H690" stroke="currentColor" opacity="0.3" fill="none"/>
        <text x="0" y="24" fill="currentColor" font-size="11">${num(max)}</text><text x="45" y="139" fill="currentColor" font-size="11">0</text>
        <text x="60" y="160" fill="currentColor" font-size="11">Tick 1</text><text x="630" y="160" fill="currentColor" font-size="11">Tick ${row.tick}</text>
        ${NAMES.map(n => `<polyline fill="none" stroke="${COLORS[n]}" stroke-width="1.5" points="${report.rows.flatMap(r => {
    const v = r.quality[n] ? chart.value(r.quality[n]!) : null
    return v !== null && Number.isFinite(v) ? [`${60 + (r.tick - 1) / Math.max(1, row.tick - 1) * 630},${135 - v / max * 110}`] : []
  }).join(' ')}"/>`).join('')}</svg>`
      }).join('')}<p class="demo-note">Quality has no pass threshold here. Lower stress measures graph-distance fit; spring mismatch reflects competing forces.
      Alignment removes translation and rotation only. Numerical checks always use raw coordinates. Coincident chart lines overlap.</p>`
      : ''
  }
  const setup = async (): Promise<void> => {
    session?.destroy(); session = undefined; status.textContent = 'Preparing matched layouts…'
    for (const name of ['webgl', 'webgpu'] as const) { const old = canvas(name); old.replaceWith(old.cloneNode()) }
    const next = await createMatchedSession({
      fixture: control('fixture').value as Settings['fixture'],
      count: Number(control('count').value),
      distribution: control('distribution').value as Settings['distribution'],
      ticks: Number(control('ticks').value),
      checkpointEvery: 10,
      preset: control('preset').value as ProductionPreset,
      pinned: control('pinned').value === 'true',
    }, canvas)
    if (destroyed) { next.destroy(); return }
    session = next; render()
    status.textContent = Object.keys(next.report.errors).length
      ? 'Partial comparison: a backend is unavailable; see its panel.'
      : 'Ready. Run the comparison to evolve all three layouts.'
  }
  const task = async (work: () => Promise<void>): Promise<void> => {
    if (busy || destroyed) return
    busy = true; stopped = false; controls()
    try { await work() } catch (error) { if (!destroyed) status.textContent = String(error) } finally { busy = false; if (!destroyed) controls() }
  }
  const run = async (steps: number, checked: boolean): Promise<void> => {
    if (!session) return
    const preview = el('.simulation-preview'); preview.style.scrollMarginTop = `${el('.playback-toolbar').offsetHeight + 12}px`
    preview.scrollIntoView({ behavior: 'smooth', block: 'start' })
    for (let i = 0; i < steps; i++) {
      if (stopped || destroyed) break
      status.textContent = `Running tick ${session.report.rows.length + 1} / ${session.settings.ticks}…`
      await session.step(checked); if (destroyed) return
      if (session.settings.ticks <= 300 || session.report.rows.length % 10 === 0 || i + 1 === steps) {
        render(); await new Promise(resolve => requestAnimationFrame(resolve))
      }
      if (Object.keys(session.report.errors).length) break
    }
    if (!destroyed) {
      render()
      status.textContent = `${stopped ? 'Stopped' : 'Finished'} at tick ${session.report.rows.length}. ${
        Object.keys(session.report.errors).length
          ? 'Partial comparison; see backend errors.'
          : session.report.rows.some(r => Object.values(r.checks).some(c => !c.valid))
            ? 'Numerical failures remain recorded below; quality is diagnostic.'
            : 'Completed checkpoints pass; other ticks are unchecked. Use the full-strength probe to test residual motion.'}`
    }
  }
  host.querySelectorAll('select').forEach(c => c.addEventListener('change', () => { task(setup) }))
  el('[data-action="run"]').addEventListener('click', () => {
    task(async () => { if (session) await run(session.settings.ticks - session.report.rows.length, false) })
  })
  el('[data-action="step"]').addEventListener('click', () => { task(async () => { await run(1, true) }) })
  el('[data-action="stop"]').addEventListener('click', () => { stopped = true })
  el('[data-action="reset"]').addEventListener('click', () => { task(setup) })
  el('[data-action="probe"]').addEventListener('click', () => {
    task(async () => {
      if (!session) return
      status.textContent = 'Probing at full strength…'; await session.probe(); render()
      if (!destroyed) {
        status.textContent = session.report.probe?.complete
          ? 'Probe completed; inspect its checks below. Original layouts and cooling restored.'
          : 'Partial probe; see backend errors. A complete comparison was not established.'
        el('[data-output="probe"]').scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    })
  })
  el('[data-action="replay"]').addEventListener('click', () => {
    task(async () => {
      if (!session) return
      await session.replay(); render()
      if (!destroyed) status.textContent = 'Replay finished. Check reproduction and restoration results below.'
    })
  })
  el('[data-action="export"]').addEventListener('click', () => {
    if (!session) return
    const text = JSON.stringify(session.report, (_key, value) => ArrayBuffer.isView(value)
      ? Array.from(value as Float32Array)
      : typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a')
    a.href = url; a.download = 'cosmos-matched-layout.json'; a.click(); URL.revokeObjectURL(url)
  })
  await task(setup)
  return { destroy (): void { destroyed = true; stopped = true; session?.destroy() } }
}
