import type { ExperimentInstance } from '../../runtime/experiment'
import { createResidentComparison, type ResidentComparison } from '../combined-layout/resident'
import { type Fixture, type SpringPrecision, PRECISION_LABELS } from '../combined-layout/data'
import { benchmarkResidentFrames, FRAME_POLICY, type FrameTimingRow } from '../combined-layout/frame-benchmark'

export async function createResidentView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<p class="demo-note">The same gravity → repulsion → incoming springs → outgoing springs tick in two WebGPU lanes.
    The staged reference reads positions for bounds. The resident lane computes bounds and draws points and links on the GPU.
    Checkpoints read both lanes for exact bit comparisons; other resident ticks have no position readback or CPU oracle.</p>
    <div class="scale-toolbar">
      <label>Graph <select data-control="fixture"><option>chain</option><option>communities</option>
        <option>star</option><option>pinned</option></select></label>
      <label>Points <select data-control="count"><option>128</option><option>512</option><option>2048</option><option>8192</option></select></label>
      <label>Ticks <select data-control="decay"><option>20</option><option>100</option><option>300</option></select></label>
      <label>Arithmetic <select data-control="precision">${(['trig', 'baseline'] as const).map(mode =>
    `<option value="${mode}">${PRECISION_LABELS[mode]}</option>`).join('')}</select></label>
    </div>
    <div class="demo-toolbar"><div class="controls"><button data-action="step">Step + check</button>
      <button data-action="run" class="button-primary">Run comparison</button>
      <button data-action="stop" disabled>Stop</button><button data-action="reset">Reset / retry</button>
      <button data-action="export" disabled>Export JSON</button></div><span class="tick-counter">Tick <strong data-output="tick">0</strong></span></div>
    <p role="status" data-output="status">Preparing WebGPU lanes…</p>
    <section class="backend-panels">${['Staged reference', 'GPU-resident'].map((name, i) => `<article class="backend-panel">
      <div class="panel-heading"><h2>${name}</h2><span data-output="reads-${i}" class="status">No snapshots</span></div>
      <canvas data-lane="${i}" width="480" height="340" aria-label="${name} layout"></canvas>
      <p class="demo-note" data-output="info-${i}"></p></article>`).join('')}</section>
    <p class="demo-note">Fixed camera; blue free points, orange pinned. Checks at tick 1, every 5 ticks and the final tick.
      Snapshot counts include both force and position buffers; bounds and hierarchy checks add checkpoint-only downloads.
      This compares dataflow on one adapter, not independent force correctness or frame rate.</p>
    <div data-output="results" class="many-body-results"></div>
    <h3>Update the current layout</h3><p class="demo-note">Use Step + check, apply an edit between ticks, then continue.
      Edits preserve the tick, cooling and existing positions. Point count stays fixed.</p>
    <div class="scale-toolbar"><button data-action="patch">Move + pin point 0</button>
      <label>New links <select data-update="links"><option>communities</option><option>chain</option>
        <option>star</option><option>empty</option></select></label>
      <button data-action="links">Replace links</button></div>
    <div data-output="updates" class="many-body-results"></div>
    <h3>Time the resident workload</h3><p class="demo-note">Measures fresh native-f32 and refined lanes from the initial fixture,
      simulation-only and with 480 × 340 point/link drawing. Two warmups, seven samples; checks and resets are outside each batch.
      Each frame uses one compute pass and one submission, plus a render pass when drawing. GPU time sums the per-pass timestamp pairs.
      This measures the engine slice, not browser presentation or FPS.</p>
    <div class="controls"><button data-action="timing">Time resident frames</button><button data-action="stop-timing" disabled>Stop timing</button></div>
    <p data-output="timing-status" role="status">Ready to measure the initial fixture.</p>
    <div data-output="timing" class="many-body-results"></div>`
  const el = <T extends HTMLElement>(q: string): T => host.querySelector<T>(q)!
  const control = (name: string): HTMLSelectElement => el(`[data-control="${name}"]`)
  const button = (name: string): HTMLButtonElement => el(`[data-action="${name}"]`)
  const status = el('[data-output="status"]')
  let session: ResidentComparison | undefined; let busy = false; let stopped = false; let destroyed = false
  let failure: string | undefined
  let timings: FrameTimingRow[] = []; let timingFailure: string | undefined; let timingBusy = false
  const settings = (): { fixture: Fixture; count: number; decay: number; checkpointEvery: number; springPrecision: SpringPrecision } => ({
    fixture: control('fixture').value as Fixture,
    count: Number(control('count').value),
    decay: Number(control('decay').value),
    checkpointEvery: 5,
    springPrecision: control('precision').value as SpringPrecision,
  })
  let activeSettings = settings()
  const controls = (): void => {
    host.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button, select').forEach(e => { e.disabled = busy })
    button('stop').disabled = !busy
    button('stop-timing').disabled = !timingBusy
    button('run').disabled = busy || !session || !!failure || session.rows.some(r => !r.valid) || session.tick() >= activeSettings.decay
    button('step').disabled = button('run').disabled
    for (const action of ['patch', 'links']) button(action).disabled = button('run').disabled
    button('export').disabled = busy || (!session?.rows.length && !session?.updates.length && !timings.length)
  }
  const render = (): void => {
    if (destroyed) return
    el('[data-output="timing"]').innerHTML = timings.length
      ? `<table><thead><tr><th>Arithmetic / workload</th><th>Frames/batch</th>
      <th>GPU work ms/frame</th><th>Range</th><th>CPU submit</th><th>Completion</th><th>Checks</th></tr></thead><tbody>${timings.map(r => {
    const summary = r.summary; const valid = !r.error && r.checks.length === 10 && r.checks.every(c => c.valid)
    return `<tr><td>${r.mode === 'trig' ? 'Refined' : 'Native f32'} / ${r.draw ? 'frame' : 'simulation'}</td><td>${r.frames}</td>
      <td>${summary?.gpuMs?.toFixed(3) ?? 'Unavailable / partial'}</td>
      <td>${summary?.gpuRange?.map(v => v.toFixed(3)).join('–') ?? '—'}</td>
      <td>${summary?.submitMs.toFixed(3) ?? '—'} ms</td><td>${summary?.completionMs.toFixed(3) ?? '—'} ms</td>
      <td>${r.error ? 'Error (export details)' : valid && r.samples.length === 7 ? '10/10 replay checks' : 'Partial'}</td></tr>`
  }).join('')}</tbody></table>`
      : ''
    if (!session) return
    session.render(); el('[data-output="tick"]').textContent = String(session.tick())
    session.readbacks.forEach((r, i) => { el(`[data-output="reads-${i}"]`).textContent = `${r.snapshots} snapshots · ${(r.bytes / 1048576).toFixed(2)} MiB` })
    el('[data-output="results"]').innerHTML = session.rows.length
      ? `<h3>Checkpoint bit differences</h3>
      <table><thead><tr><th>Tick</th><th>Bounds</th><th>Positions</th><th>Forces</th><th>Aggregates</th>
        <th>Samples</th><th>Centroids</th><th>Result</th></tr></thead>
      <tbody>${session.rows.map(r => `<tr><td>${r.tick}</td><td>${r.bounds}</td><td>${r.positions}</td><td>${r.forces}</td>
        <td>${r.aggregates}</td><td>${r.slots}</td><td>${r.centroids}</td>
        <td>${r.valid ? 'Pass' : !r.finite ? 'Non-finite' : 'FAIL'}</td></tr>`).join('')}</tbody></table>`
      : ''
    el('[data-output="updates"]').innerHTML = session.updates.length
      ? `<table><thead><tr><th>Tick</th><th>Edit</th>
      <th>CPU submit, staged / resident</th><th>Bytes per lane</th><th>Device / positions</th></tr></thead><tbody>${session.updates.map(u =>
    `<tr><td>${u.tick}</td><td>${u.description}</td><td>${u.lanes.map(l => l.submitMs.toFixed(3)).join(' / ')} ms</td>
      <td>${u.lanes.map(l => l.bytes.toLocaleString()).join(' / ')}</td>
      <td>${u.lanes.every(l => l.deviceRetained && l.positionsRetained) ? 'Retained' : 'FAIL'}</td></tr>`).join('')}</tbody></table>`
      : ''
  }
  const reset = async (): Promise<void> => {
    busy = true; session?.destroy(); session = undefined; failure = undefined; controls(); button('stop').disabled = true; activeSettings = settings()
    timings = []; timingFailure = undefined
    el('[data-output="timing-status"]').textContent = 'Ready to measure the initial fixture.'
    el('[data-output="tick"]').textContent = '0'
    for (const name of ['results', 'updates', 'timing']) el(`[data-output="${name}"]`).replaceChildren()
    for (const i of [0, 1]) el(`[data-output="reads-${i}"]`).textContent = 'No snapshots'
    status.textContent = 'Preparing WebGPU lanes…'
    try {
      const next = await createResidentComparison(activeSettings, resident => el(`[data-lane="${resident ? 1 : 0}"]`))
      if (destroyed) { next.destroy(); return }
      session = next; next.info.forEach((info, i) => { el(`[data-output="info-${i}"]`).textContent = info })
      render(); status.textContent = 'Ready. Run the comparison to check GPU bounds and composed ticks.'
    } catch (error) {
      session?.destroy(); session = undefined
      if (!destroyed) status.textContent = String(error)
    } finally { busy = false; if (!destroyed) controls() }
  }
  button('run').addEventListener('click', async () => {
    if (busy || !session) return
    busy = true; stopped = false; controls()
    try {
      while (!stopped && session.tick() < activeSettings.decay) {
        if (destroyed) return
        status.textContent = `Running tick ${session.tick() + 1} / ${activeSettings.decay}…`
        const check = await session.step()
        if (destroyed) return
        render()
        if (check && !check.valid) { stopped = true; break }
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
      status.textContent = `${stopped ? 'Stopped' : 'Finished'} at tick ${session.tick()}. ` +
        `${session.rows.filter(r => r.valid).length} / ${session.rows.length} checkpoints match exactly. Unchecked ticks are not validated.`
    } catch (error) {
      failure = String(error)
      if (!destroyed) status.textContent = `${failure}. Use Reset / retry to restart both lanes.`
    } finally { busy = false; if (!destroyed) controls() }
  })
  button('stop').addEventListener('click', () => { stopped = true })
  button('step').addEventListener('click', async () => {
    if (busy || !session) return
    busy = true; controls()
    try {
      const row = await session.step(true)
      if (!destroyed) {
        render(); status.textContent = `Tick ${session.tick()}: ${row?.valid ? 'all compared bits match' : 'FAIL'}. Apply an edit or continue.`
      }
    } catch (error) { failure = String(error); if (!destroyed) status.textContent = failure } finally { busy = false; if (!destroyed) controls() }
  })
  for (const action of ['patch', 'links']) {
    button(action).addEventListener('click', () => {
      if (busy || !session) return
      try {
        if (action === 'patch') session.patchPoint(0, new Float32Array([-32, 16, 1, 0]))
        else session.replaceLinks(el<HTMLSelectElement>('[data-update="links"]').value as Fixture | 'empty')
        render(); status.textContent = `Edit applied at tick ${session.tick()}; cooling and resident positions retained. ` +
          'Step + check to validate the next tick.'
      } catch (error) { failure = String(error); status.textContent = failure }
      controls()
    })
  }
  button('timing').addEventListener('click', async () => {
    if (busy) return
    busy = true; timingBusy = true; stopped = false; timings = []; timingFailure = undefined; controls()
    try {
      await benchmarkResidentFrames({
        settings: activeSettings,
        rows: timings,
        cancelled: () => stopped || destroyed,
        progress: message => {
          if (!destroyed) { status.textContent = message; el('[data-output="timing-status"]').textContent = message }
        },
      })
      if (!destroyed) {
        render()
        const outcome = stopped ? 'Timing stopped; partial rows retained' : timings.some(r => r.error) ? 'Timing incomplete; inspect errors' : 'Timing finished'
        status.textContent = `${outcome}. Current comparison state is preserved.`
        el('[data-output="timing-status"]').textContent = status.textContent
      }
    } catch (error) {
      timingFailure = String(error)
      if (!destroyed) { render(); status.textContent = timingFailure; el('[data-output="timing-status"]').textContent = timingFailure }
    } finally { busy = false; timingBusy = false; if (!destroyed) controls() }
  })
  button('stop-timing').addEventListener('click', () => { stopped = true })
  button('reset').addEventListener('click', () => { if (!busy) reset().catch(() => {}) })
  host.querySelectorAll('select[data-control]').forEach(select => select.addEventListener('change', () => { if (!busy) reset().catch(() => {}) }))
  button('export').addEventListener('click', () => {
    if (!session && !timings.length) return
    const blob = new Blob([JSON.stringify({
      experiment: 'resident-layout',
      gpuApi: 'luma',
      settings: activeSettings,
      browser: navigator.userAgent,
      info: session?.info ?? [],
      tick: session?.tick() ?? 0,
      alpha: session?.alpha() ?? null,
      rows: session?.rows ?? [],
      readbacks: session?.readbacks ?? [],
      updates: session?.updates ?? [],
      framePolicy: FRAME_POLICY,
      frameTimings: timings,
      frameTimingError: timingFailure,
      error: failure,
    }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url
    a.download = `cosmos-resident-layout-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  await reset()
  return { destroy (): void { destroyed = true; stopped = true; session?.destroy() } }
}
