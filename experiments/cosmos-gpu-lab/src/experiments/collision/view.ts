import type { ExperimentInstance } from '../../runtime/experiment'
import { collisionView } from './camera'
import { FIXTURES, TOPOLOGIES, COLLISION, overlap, radius, type Settings } from './data'
import { createCollisionSession, type CollisionSession } from './session'
import { COST_POLICY, collisionCostSummary, measureCollisionCost } from './timing'
const NAMES = ['webgl', 'webgpu', 'cpu'] as const
const LABELS = { webgl: 'Production GLSL · WebGL', webgpu: 'luma WebGPU', cpu: 'CPU reference' }
const num = (n: number | undefined | null): string => n === null || n === undefined ? '—' : n.toExponential(2)
const ms = (n: number | null): string => n === null ? '—' : n.toFixed(3)
export async function createCollisionView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<p class="demo-note">Collision separates overlapping discs. Compare shared CPU inputs or let WebGL, WebGPU and CPU evolve independently.
    Tick checks and accumulated trajectory differences use the same unchanged tolerances.</p>
    <div class="scale-toolbar">
      <label>Fixture <select data-control="fixture">${FIXTURES.map(f => `<option${f === 'uniform' ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
      <label>Points <select data-control="count">${[2, 8, 32, 128, 512, 1024]
    .map(n => `<option${n === 128 ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Workload <select data-control="mode"><option value="collision">Collision only</option>
        <option value="combined">Combined forces</option></select></label>
      <label>Evolution <select data-control="evolution"><option value="shared">Shared CPU input per tick</option>
        <option value="independent">Independent layouts</option></select></label>
      <label>Topology <select data-control="topology">${TOPOLOGIES.map(t => `<option>${t}</option>`).join('')}</select></label>
      <label>Alpha schedule <select data-control="coolingTicks"><option value="0">Fixed alpha</option>
        <option value="100">Cool over 100 ticks</option><option value="300">Cool over 300 ticks</option></select></label>
      <label>Passes per tick <select data-control="iterations"><option>1</option><option>2</option><option>4</option></select></label>
      <label>Collision arithmetic (WebGPU) <select data-control="arithmetic"><option value="native">Native f32</option>
        <option value="strict">Strict reference</option></select></label>
    </div>
    <details class="advanced-controls"><summary>Radius, strength, cooling and center precision</summary><div class="scale-toolbar">
      <label>Center reduction (WebGPU) <select data-control="centerReduction"><option value="high-low">High/low sum · corrected</option>
        <option value="f32">Float32 tree · original control</option></select></label>
      <label>Radius <select data-control="radius"><option value="0">Size / 2 · variable</option>
        <option value="4">Fixed 4</option>
        <option value="8">Fixed 8</option></select></label>
      <label>Padding <select data-control="padding"><option>0</option><option selected>0.25</option><option>1</option></select></label>
      <label>Strength <select data-control="strength"><option>0.25</option><option selected>1</option></select></label>
      <label>Alpha <select data-control="alpha"><option>1</option><option>0.01</option><option>0</option></select></label>
      <label>Collision cooling exponent <select data-control="cooling"><option>0</option>
        <option>0.5</option>
        <option>1</option>
        <option>2</option></select></label>
    </div></details>
    <div class="demo-toolbar playback-toolbar"><div class="controls">
      <button data-action="step" class="button-primary">Step + validate</button><button data-action="run">100 validated ticks</button>
      <button data-action="schedule" disabled>Run cooling schedule</button>
      <button data-action="stop" disabled>Stop</button><button data-action="reset">Reset</button>
      <button data-action="replay" disabled>Replay failures</button><button data-action="cost">Measure added GPU cost</button>
      <button data-action="center-cost" disabled>Compare center precision cost</button>
      <button data-action="export" disabled>Export JSON</button>
    </div><span class="tick-counter">Tick <strong data-output="tick">0</strong></span></div>
    <p role="status" class="many-body-status" data-output="status">Preparing devices…</p>
    <section class="simulation-preview"><div class="backend-panels many-body-panels">${NAMES.map(name => `<article class="backend-panel">
      <div class="panel-heading"><h2>${LABELS[name]}</h2><span class="status" data-state="${name}">Preparing</span></div>
      <canvas width="480" height="340" data-canvas="${name}" aria-label="${LABELS[name]} collision discs"></canvas>
      <p class="demo-note" data-info="${name}"></p></article>`).join('')}</div></section>
    <p class="demo-note" data-output="pipeline"></p>
    <div class="many-body-results" data-output="trajectory"></div>
    <div class="trajectory-chart" data-output="charts"></div>
    <div class="many-body-results" data-output="center"></div>
    <div class="many-body-results" data-output="overlap"></div><div class="many-body-results" data-output="checks"></div>
    <div class="many-body-results" data-output="cost"></div>
    <p class="demo-note">Exact all-pairs collision, limited to small graphs. Discs show effective world-space radii; orange centers are pinned.
      Validation includes readback and CPU work. Use the paired GPU measurement for cost, not the elapsed validation time.
      <a href="#/collision/docs/method">Method and scope</a> · <a href="#/collision/docs/trajectories">Independent findings</a> ·
      <a href="#/collision/docs/findings">Center-correction findings</a>.</p>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const control = (name: string): HTMLSelectElement => el(`[data-control="${name}"]`)
  const canvas = (name: string): HTMLCanvasElement => el(`[data-canvas="${name}"]`)
  const status = el('[data-output="status"]')
  let session: CollisionSession | undefined; let busy = false; let stopped = false; let destroyed = false
  const controls = (): void => {
    host.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button,select').forEach(c => { c.disabled = busy })
    el<HTMLButtonElement>('[data-action="stop"]').disabled = !busy
    el<HTMLButtonElement>('[data-action="export"]').disabled = busy || !session || (!session.report.rows.length && !session.report.cost)
    el<HTMLButtonElement>('[data-action="replay"]').disabled = busy ||
      (!Object.keys(session?.report.failures ?? {}).length && !Object.keys(session?.report.trajectoryFailures ?? {}).length)
    el<HTMLButtonElement>('[data-action="center-cost"]').disabled = busy || control('mode').value !== 'combined'
    const finished = !!session?.settings.coolingTicks && session.report.rows.length >= session.settings.coolingTicks
    for (const action of ['step', 'run']) el<HTMLButtonElement>(`[data-action="${action}"]`).disabled = busy || finished
    el<HTMLButtonElement>('[data-action="schedule"]').disabled = busy || finished || !Number(control('coolingTicks').value)
    control('count').disabled = busy || ['pair', 'masks'].includes(control('fixture').value)
    control('topology').disabled = busy || control('mode').value !== 'combined'
  }
  const render = (): void => {
    if (!session || destroyed) return
    const { report, settings, graph } = session; const cpu = session.cpu(); const row = report.rows.at(-1)
    const view = collisionView([cpu, ...session.lanes.map(l => l.positions)], graph.sizes, settings.collision)
    for (const lane of session.lanes) {
      if (!report.errors[lane.api]) {
        try { lane.backend.render(view) } catch (error) { report.errors[lane.api] = String(error) }
      }
    }
    const c = canvas('cpu'); const ctx = c.getContext('2d')!
    ctx.fillStyle = '#13161b'; ctx.fillRect(0, 0, c.width, c.height)
    for (let i = 0; i < graph.sizes.length; i++) {
      if (cpu[i * 4 + 3] > 0.5) continue
      const x = ((cpu[i * 4] - view[0]) * view[2] + 1) * 240; const y = (1 - (cpu[i * 4 + 1] - view[1]) * view[3]) * 170
      const r = radius(graph.sizes[i], settings.collision) * view[3] * 170
      const pinned = cpu[i * 4 + 2] > 0.5
      // Keep the outline inside the physical radius, like both GPU shaders.
      ctx.fillStyle = pinned ? '#e7b882' : '#9fb5d5'; ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill()
      ctx.fillStyle = pinned ? '#5d4934' : '#3f4956'; ctx.beginPath(); ctx.arc(x, y, r * 0.88, 0, 2 * Math.PI); ctx.fill()
      ctx.fillStyle = pinned ? '#ffb866' : '#9fb5d5'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fill()
    }
    el('[data-output="tick"]').textContent = String(report.rows.length)
    el('[data-output="pipeline"]').textContent = `${settings.mode === 'combined'
      ? 'Gravity → center → exact repulsion → incoming springs → outgoing springs → collision'
      : 'Collision'} · ${settings.collision.iterations} collision pass(es) per tick · friction 1 for collision · alpha ${session.alpha().toPrecision(3)}, ` +
      `${settings.coolingTicks ? `cooling over ${settings.coolingTicks} ticks` : 'fixed'} · ` +
      `cooling exponent ${settings.collision.cooling} · radius ${settings.collision.radius || 'size / 2'} + padding ${settings.collision.padding}.${
        settings.mode === 'combined' ? ` ${settings.topology} topology; WebGPU center: ${settings.centerReduction ?? 'high-low'}.` : ''} ${
        settings.evolution === 'independent' ? 'Independent GPU/CPU positions between ticks; no shared-state reset.' : 'Shared CPU input per tick.'}`
    for (const name of NAMES) {
      const errors = name === 'cpu' ? undefined : report.errors[name]
      const failed = name === 'cpu' ? 0 : report.rows.filter(r => r.checks[name]?.valid === false).length
      el(`[data-state="${name}"]`).textContent = errors
        ? 'Unavailable / stopped'
        : name === 'cpu'
          ? 'Independent oracle'
          : `${report.rows.filter(r => r.checks[name]?.valid).length}/${report.rows.length} tick checks`
      el(`[data-info="${name}"]`).textContent = errors ?? (name === 'cpu'
        ? 'Stepwise float32 arithmetic · Canvas2D preview'
        : `${report.devices[name] ?? 'Unavailable'} · ${failed} failed tick checks · ` +
          `${report.rows.filter(r => r.trajectory[name]?.valid).length}/${report.rows.length} trajectory checks vs CPU pass`)
    }
    el('[data-output="trajectory"]').innerHTML = row
      ? `<table><caption>Tick ${row.tick} · ${settings.evolution === 'independent' ? 'independent trajectories' : 'shared-input outputs'}</caption>
      <thead><tr><th>Path</th><th>Tick checks pass</th><th>Trajectory checks pass</th><th>Raw RMS drift / CPU radius</th>
      <th>Aligned RMS / CPU radius</th></tr></thead><tbody>
      ${NAMES.map(name => {
    const m = row.metrics[name]
    return `<tr><td>${LABELS[name]}</td>
      <td>${name === 'cpu' ? 'Reference' : `${report.rows.filter(r => r.checks[name]?.valid).length}/${report.rows.length}`}</td>
      <td>${name === 'cpu' ? 'Reference' : `${report.rows.filter(r => r.trajectory[name]?.valid).length}/${report.rows.length}`}</td>
      <td>${m?.normalizedDrift === null || m?.normalizedDrift === undefined ? '—' : `${(100 * m.normalizedDrift).toFixed(3)}%`}</td>
      <td>${m && row.metrics.cpu?.shape.radius ? `${(100 * m.alignedRms / row.metrics.cpu.shape.radius).toFixed(3)}%` : '—'}</td></tr>`
  }).join('')}</tbody></table>
      <table><caption>Layout geometry · descriptive metrics</caption><thead><tr><th>Path</th><th>Motion RMS</th>
      <th>Layout radius</th><th>Stress RMS</th><th>Finite</th></tr></thead><tbody>
      ${NAMES.map(name => {
    const m = row.metrics[name]
    return `<tr><td>${LABELS[name]}</td><td>${num(m?.motion.rms)}</td><td>${num(m?.shape.radius)}</td>
      <td>${num(m?.stress.rms)}</td><td>${m ? m.shape.finite ? 'Yes' : 'NO' : '—'}</td></tr>`
  }).join('')}</tbody></table>
      <p class="demo-note">Tick checks compare each GPU step with the CPU calculation from that GPU’s own input.
      Trajectory checks compare accumulated raw coordinates with the independently evolving CPU at the original position tolerance.
      Drift, motion, stress and overlap are separate observations; they never waive a failed coordinate gate.
      Alignment removes translation and rotation only; numerical gates use raw coordinates.
      All paths share the initial graph, fixed random samples and alpha schedule.
      ${settings.evolution === 'shared' ? 'Shared-input mode resets both GPUs each tick.' : ''}</p>`
      : ''
    const colors = { webgl: '#e7b882', webgpu: '#9fb5d5', cpu: '#c7b1e0' }
    const charts = [
      { title: 'RMS drift from CPU · world units', value: (r: typeof row, name: typeof NAMES[number]): number | undefined => r?.metrics[name]?.drift.rms },
      {
        title: 'Maximum penetration · world units',
        value: (r: typeof row, name: typeof NAMES[number]): number | undefined => r?.overlap[name]?.maxPenetration,
      },
    ]
    el('[data-output="charts"]').innerHTML = row
      ? `<p>${NAMES.map(n => `<span style="color:${colors[n]}">${LABELS[n]}</span>`).join(' · ')}</p>${charts.map(chart => {
        const values = report.rows.flatMap(r => NAMES.map(n => chart.value(r, n))).filter((v): v is number => v !== undefined && Number.isFinite(v))
        const max = Math.max(1e-12, ...values)
        return `<h3>${chart.title}</h3><svg viewBox="0 0 720 170" role="img" aria-label="${chart.title} over ${row.tick} ticks">
        <path d="M60 20 V135 H690" stroke="currentColor" opacity="0.3" fill="none"/>
        <text x="0" y="24" fill="currentColor" font-size="11">${num(max)}</text><text x="45" y="139" fill="currentColor" font-size="11">0</text>
        <text x="60" y="160" fill="currentColor" font-size="11">Tick 1</text><text x="630" y="160" fill="currentColor" font-size="11">Tick ${row.tick}</text>
        ${NAMES.map(n => `<polyline fill="none" stroke="${colors[n]}" stroke-width="1.5" points="${report.rows.flatMap(r => {
    const v = chart.value(r, n)
    return v !== undefined && Number.isFinite(v) ? [`${60 + (r.tick - 1) / Math.max(1, row.tick - 1) * 630},${135 - v / max * 110}`] : []
  }).join(' ')}"/>`).join('')}</svg>`
      }).join('')}`
      : ''
    el('[data-output="center"]').innerHTML = settings.mode === 'combined' && report.rows.length
      ? `<table><caption>Center precision · maximum absolute error across ${report.rows.length} validated ticks</caption>
      <thead><tr><th>Path</th><th>Position sum / count</th><th>Force</th><th>Integrated position</th></tr></thead><tbody>
      ${(['webgl', 'webgpu'] as const).map(api => {
    const stages = report.rows.flatMap(r => r.checks[api]?.stages.filter(s => s.stage === 'center') ?? [])
    return `<tr><td>${LABELS[api]}</td>${(['aggregate', 'forces', 'positions'] as const).map(key =>
      `<td>${stages.length ? num(Math.max(...stages.map(s => s[key]?.maxError ?? 0))) : '—'}</td>`).join('')}</tr>`
  }).join('')}</tbody></table>`
      : ''
    el('[data-output="overlap"]').innerHTML = `<table><caption>Geometric overlap · measured separately from numerical tolerance</caption>
      <thead><tr><th>Path</th><th>Overlapping pairs</th><th>Both pinned</th><th>Maximum penetration</th></tr></thead><tbody>
      ${NAMES.map(name => {
    const positions = name === 'cpu' ? cpu : session!.lanes.find(l => l.api === name)?.positions
    const metric = row?.overlap[name] ?? (positions ? overlap(positions, graph.sizes, settings.collision) : undefined)
    return `<tr><td>${LABELS[name]}</td><td>${metric?.pairs ?? '—'}</td><td>${metric?.pinnedPairs ?? '—'}</td><td>${num(metric?.maxPenetration)}</td></tr>`
  }).join('')}</tbody></table>`
    el('[data-output="checks"]').innerHTML = row
      ? `<table><caption>Tick ${row.tick} · unchanged CPU gates from each GPU’s starting state</caption>
      <thead><tr><th>Path / stage</th><th>Force failures</th><th>Position failures</th><th>Flags exact</th><th>Result</th></tr></thead><tbody>
      ${(['webgl', 'webgpu'] as const).map(api => `${(row.checks[api]?.stages ?? []).map((check, i) => `<tr><td>${LABELS[api]} · ${i + 1}. ${check.stage}</td>
        <td>${check.forces.failures}</td>
        <td>${check.positions.failures}</td>
        <td>${check.flagsExact ? 'Yes' : 'No'}</td>
        <td>${check.valid ? 'Pass' : 'FAIL'}</td></tr>`).join('')
  }<tr><td>${LABELS[api]} · whole tick</td><td>—</td><td>${row.checks[api]?.whole.failures ?? '—'}</td><td>Included</td>
        <td>${row.checks[api]?.whole.valid ? 'Pass' : row.checks[api] ? 'FAIL' : 'Unavailable'}</td></tr>
      <tr><td>${LABELS[api]} · trajectory vs CPU</td><td>—</td><td>${row.trajectory[api]?.failures ?? '—'}</td><td>Included</td>
      <td>${row.trajectory[api]?.valid ? 'Pass' : row.trajectory[api] ? 'FAIL' : 'Unavailable'}</td></tr>`).join('')}
      <tr><td>WebGPU vs WebGL positions</td><td>—</td><td>${row.cross?.failures ?? '—'}</td><td>Included</td>
      <td>${row.cross?.valid ? 'Pass' : row.cross ? 'FAIL' : 'Unavailable'}</td></tr></tbody></table>`
      : ''
    const failures = report.rows.flatMap(r => (['webgl', 'webgpu'] as const).flatMap(api => {
      const gate = r.checks[api]; if (!gate || gate.valid) return []
      const stages = gate.stages.filter(check => !check.valid).map(check => `${check.stage}: ${check.forces.failures} force, ` +
        `${check.positions.failures} position, ${check.aggregate?.failures ?? 0} aggregate${check.flagsExact ? '' : ', flags differ'}`).join('; ')
      return [`<tr><td>${LABELS[api]}</td><td>${r.tick}</td><td>${stages || 'All local gates pass'}</td><td>${gate.whole.failures}</td></tr>`]
    }))
    const trajectoryFailures = Object.entries(report.trajectoryFailures)
    if (trajectoryFailures.length) {
      el('[data-output="trajectory"]').insertAdjacentHTML('beforeend', `<table><caption>First accumulated trajectory difference · retained for replay</caption>
      <thead><tr><th>Path</th><th>Tick</th><th>Alpha</th><th>Coordinate failures</th><th>Max error</th></tr></thead><tbody>
      ${trajectoryFailures.map(([api, capture]) => {
    const gate = report.rows[capture.tick - 1].trajectory[api as 'webgl' | 'webgpu']!
    return `<tr><td>${LABELS[api as 'webgl' | 'webgpu']}</td><td>${capture.tick}</td><td>${num(capture.alpha)}</td>
      <td>${gate.failures}</td><td>${num(gate.maxError)}</td></tr>`
  }).join('')}</tbody></table>`)
    }
    if (failures.length) {
      el('[data-output="checks"]').insertAdjacentHTML('afterbegin', `<details><summary>Tick failure history · ${failures.length} entries</summary>
      <table><caption>Failed ticks · retained across the run</caption>
      <thead><tr><th>Path</th><th>Tick</th><th>Local stage failures</th><th>Whole-tick position failures</th></tr></thead>
      <tbody>${failures.join('')}</tbody></table></details>`)
    }
    if (row && Object.values(row.checks).some(gate => gate.stages.some(check => check.absentSpringTargets > 0))) {
      const note = document.createElement('p'); note.className = 'demo-note'
      note.textContent = 'Absent points keep their positions and flags. Unused spring corrections are excluded; collision must still return zero for them.'
      el('[data-output="checks"]').append(note)
    }
    const cost = report.cost
    const centerCost = cost?.comparison === 'center-reduction'
    el('[data-output="cost"]').innerHTML = cost
      ? `<h3>${centerCost ? 'Center precision GPU cost · float32 → high/low' : 'Added collision GPU cost · off → on'}</h3>
      <p class="demo-note">${cost.status} · frozen CPU geometry after ${cost.frozenTick} ticks ·
      ${cost.policy.frames} WebGPU frames per observation${centerCost ? '; WebGPU only' : '; one WebGL frame'}.
      Force/integration and drawing are timed; uploads, capture copies and readback are outside GPU timestamps.</p>
      <table><thead><tr><th>Path / block</th>
        <th>Gate</th>
        <th>${centerCost ? 'Float32' : 'Off'} ms</th>
        <th>${centerCost ? 'High/low' : 'On'} ms</th>
        <th>Paired added ms</th>
        <th>Pair range ms</th>
        <th>Added %</th></tr></thead><tbody>
      ${(centerCost ? ['webgpu'] as const : ['webgl', 'webgpu'] as const).map(api => Array.from({ length: cost.policy.blocks }, (_, block) => {
    const summary = collisionCostSummary(cost, api, block)
    return `<tr><td>${LABELS[api]} · ${block + 1}</td><td>${summary.accepted ? 'Pass' : 'Rejected / incomplete'}</td>
      <td>${ms(summary.offMs)}</td><td>${ms(summary.onMs)}</td><td>${ms(summary.deltaMs)}</td>
      <td>${summary.range ? summary.range.map(ms).join(' … ') : '—'}</td><td>${summary.percent?.toFixed(1) ?? '—'}</td></tr>`
  }).join('')).join('')}</tbody></table><details><summary>Inspect timing gates</summary>
      <table><thead><tr><th>Path / control</th><th>Local stage gates</th><th>Whole-tick failures</th></tr></thead><tbody>
      ${cost.preflight.map(p => `<tr><td>${LABELS[p.api]} · ${centerCost ? p.enabled ? 'high/low' : 'float32' : p.enabled ? 'on' : 'off'}</td>
        <td>${p.gate.stages.every(check => check.valid) ? 'Pass' : 'FAIL'}</td>
        <td>${p.gate.whole.failures}</td></tr>`).join('')}</tbody></table></details>
      <p class="demo-note">Acceptance requires both scalar preflights, every timed-frame replay and valid queries, including warmups.
      Added cost is the median paired ${centerCost ? 'high/low − float32' : 'on − off'} difference; columns are separate medians. Inspect ranges for noise.
      ${centerCost
    ? 'Both controls retain every collision pass and the spring floor; only the GPU center sum changes.'
    : 'This measures the selected workload, including the collision spring floor in combined mode.'} This is not production Graph FPS.</p>`
      : ''
    controls()
  }
  const task = async (work: () => Promise<void>): Promise<void> => {
    if (busy || destroyed) return
    busy = true; stopped = false; controls()
    try { await work() } catch (error) { if (!destroyed) status.textContent = String(error) } finally { busy = false; if (!destroyed) controls() }
  }
  const setup = async (): Promise<void> => {
    session?.destroy(); session = undefined; status.textContent = 'Preparing collision backends…'
    for (const name of ['webgl', 'webgpu']) { const old = canvas(name); old.replaceWith(old.cloneNode()) }
    const collision = { ...COLLISION }
    for (const key of ['radius', 'strength', 'padding', 'cooling', 'iterations'] as const) collision[key] = Number(control(key).value)
    session = await createCollisionSession({
      fixture: control('fixture').value as Settings['fixture'],
      count: Number(control('count').value),
      mode: control('mode').value as Settings['mode'],
      evolution: control('evolution').value as Settings['evolution'],
      topology: control('topology').value as Settings['topology'],
      coolingTicks: Number(control('coolingTicks').value),
      arithmetic: control('arithmetic').value as Settings['arithmetic'],
      centerReduction: control('centerReduction').value as Settings['centerReduction'],
      alpha: Number(control('alpha').value),
      collision,
    }, canvas)
    if (destroyed) { session.destroy(); return }
    control('count').value = String(session.settings.count)
    render(); status.textContent = Object.keys(session.report.errors).length
      ? 'Partial comparison: inspect unavailable paths.'
      : 'Ready. Step to validate each collision pass.'
  }
  const run = async (count: number): Promise<void> => {
    if (session!.settings.coolingTicks) count = Math.min(count, session!.settings.coolingTicks - session!.report.rows.length)
    el('.playback-toolbar').scrollIntoView({ block: 'start' })
    for (let i = 0; i < count; i++) {
      if (stopped || destroyed) break
      status.textContent = `Validating tick ${session!.report.rows.length + 1}…`
      await session!.step(); if (destroyed) return; render(); await new Promise(resolve => setTimeout(resolve, 0))
    }
    if (destroyed) return
    const report = session!.report
    const failures = report.rows.filter(r => !r.complete || Object.values(r.checks).some(c => !c.valid)).length
    const trajectoryFailures = report.rows.filter(r => Object.values(r.trajectory).some(c => !c.valid)).length
    status.textContent = `${stopped ? 'Stopped' : 'Finished'} · ${report.rows.length} ${session!.settings.evolution} ticks · ` +
      `${failures} ticks with local/whole failures · ${trajectoryFailures} ticks with trajectory differences. Validation elapsed time is not GPU time.`
  }
  host.querySelectorAll('select').forEach(c => c.addEventListener('change', () => { task(setup) }))
  el('[data-action="step"]').addEventListener('click', () => { task(async () => { await run(1) }) })
  el('[data-action="run"]').addEventListener('click', () => { task(async () => { await run(100) }) })
  el('[data-action="schedule"]').addEventListener('click', () => {
    task(async () => { await run(session!.settings.coolingTicks! - session!.report.rows.length) })
  })
  el('[data-action="stop"]').addEventListener('click', () => { stopped = true })
  el('[data-action="reset"]').addEventListener('click', () => { task(setup) })
  el('[data-action="replay"]').addEventListener('click', () => {
    task(async () => {
      await session!.replay(); render()
      status.textContent = session!.report.replays.map(r => `${r.api} ${r.kind}: reproduced ${r.reproduced}, restored ${r.restored}`).join(' · ')
    })
  })
  for (const action of ['cost', 'center-cost']) {
    el(`[data-action="${action}"]`).addEventListener('click', () => {
      task(async () => {
        status.scrollIntoView({ block: 'nearest' })
        const current = session!
        current.report.cost = await measureCollisionCost({ ...current.settings, alpha: current.alpha() }, current.cpu(),
          text => { if (!destroyed) status.textContent = text }, () => stopped || destroyed, COST_POLICY, current.report.rows.length,
          action === 'center-cost' ? 'center-reduction' : 'collision')
        if (!destroyed) {
          render(); status.textContent = `GPU cost comparison ${current.report.cost.status}; inspect gates below. Demo state unchanged.`
          el('[data-output="cost"]').scrollIntoView({ block: 'center' })
        }
      })
    })
  }
  el('[data-action="export"]').addEventListener('click', () => {
    const serialized = JSON.stringify(session!.report, (_key, value) => ArrayBuffer.isView(value)
      ? Array.from(value as Float32Array)
      : typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2)
    const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' })); const link = document.createElement('a')
    link.href = url; link.download = 'cosmos-collision.json'; link.click(); URL.revokeObjectURL(url)
  })
  await task(setup)
  return { destroy (): void { destroyed = true; stopped = true; session?.destroy() } }
}
