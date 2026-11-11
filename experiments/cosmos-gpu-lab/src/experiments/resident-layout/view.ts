import type { ExperimentInstance } from '../../runtime/experiment'
import { createResidentComparison, type ResidentComparison } from '../combined-layout/resident'
import { type Fixture, type SpringPrecision, PRECISION_LABELS } from '../combined-layout/data'

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
    <div class="demo-toolbar"><div class="controls"><button data-action="run" class="button-primary">Run comparison</button>
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
    <div data-output="results" class="many-body-results"></div>`
  const el = <T extends HTMLElement>(q: string): T => host.querySelector<T>(q)!
  const control = (name: string): HTMLSelectElement => el(`[data-control="${name}"]`)
  const button = (name: string): HTMLButtonElement => el(`[data-action="${name}"]`)
  const status = el('[data-output="status"]')
  let session: ResidentComparison | undefined; let busy = false; let stopped = false; let destroyed = false
  let failure: string | undefined
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
    button('run').disabled = busy || !session || !!failure || session.rows.some(r => !r.valid) || session.tick() >= activeSettings.decay
    button('export').disabled = busy || !session?.rows.length
  }
  const render = (): void => {
    if (!session || destroyed) return
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
  }
  const reset = async (): Promise<void> => {
    busy = true; session?.destroy(); session = undefined; failure = undefined; controls(); button('stop').disabled = true; activeSettings = settings()
    el('[data-output="tick"]').textContent = '0'; el('[data-output="results"]').replaceChildren()
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
  button('reset').addEventListener('click', () => { if (!busy) reset().catch(() => {}) })
  host.querySelectorAll('select').forEach(select => select.addEventListener('change', () => { if (!busy) reset().catch(() => {}) }))
  button('export').addEventListener('click', () => {
    if (!session) return
    const blob = new Blob([JSON.stringify({
      experiment: 'resident-layout',
      gpuApi: 'luma',
      settings: activeSettings,
      browser: navigator.userAgent,
      info: session.info,
      tick: session.tick(),
      alpha: session.alpha(),
      rows: session.rows,
      readbacks: session.readbacks,
      error: failure,
    }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url
    a.download = `cosmos-resident-layout-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  await reset()
  return { destroy (): void { destroyed = true; stopped = true; session?.destroy() } }
}
