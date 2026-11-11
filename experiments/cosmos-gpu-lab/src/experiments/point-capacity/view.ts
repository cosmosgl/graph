import type { ExperimentInstance } from '../../runtime/experiment'
import { createCapacitySession, type CapacitySession } from '../combined-layout/capacity-session'
import { CAPACITY_CYCLE } from '../combined-layout/capacity'
import type { Fixture, Settings } from '../combined-layout/data'
const mib = (bytes: number): string => (bytes / 1048576).toFixed(3)
export async function createCapacityView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<p class="demo-note">Resize storage without resetting devices, tick or cooling. The CPU reference downloads the surviving prefix;
    the resident path copies it on the GPU and uploads only new tail positions. Refined arithmetic; immediate updates; fixed camera.</p>
    <div class="scale-toolbar"><label>Graph <select data-control="fixture"><option>chain</option><option>communities</option>
      <option>star</option></select></label>
      <label>Repetitions <select data-control="repeats"><option>1</option><option selected>3</option><option>5</option></select></label>
      <label class="checkbox-control"><input data-control="cpu" type="checkbox" checked> Check unchanged CPU tolerance</label></div>
    <div class="controls"><button data-action="step">Step + validate</button><button data-action="cycle" class="button-primary">Run resize cycles</button>
      <button data-action="stop" disabled>Stop</button><button data-action="reset">Reset / retry</button>
      <button data-action="export" disabled>Export JSON</button></div>
    <p data-output="status" role="status">Preparing 2,048-point lanes…</p>
    <section class="backend-panels">${['CPU-copy reference', 'GPU-resident copy'].map((name, i) => `<article class="backend-panel">
      <div class="panel-heading"><h2>${name}</h2><span data-output="memory-${i}" class="status">Starting</span></div>
      <canvas data-lane="${i}" width="480" height="340" aria-label="${name} capacity layout"></canvas>
      <p class="demo-note" data-output="info-${i}"></p></article>`).join('')}</section>
    <p class="demo-note">Cycle: 2,048 → 8,192 → 4,096 → 8,192 → 2,048. A resize preserves surviving indices, pinning and absence;
      regrowth initializes the removed tail. Checks download snapshots outside each measured update/frame.</p>
    <h3>Immediate edits</h3><div class="scale-toolbar">
      <label>New point count <select data-control="target"><option>2048</option><option selected>8192</option><option>4096</option></select></label>
      <button data-action="resize">Resize + preserve</button><button data-action="replace">Replace all positions</button>
      <button data-action="pin">Move + pin point 0</button><button data-action="hide">Hide point 1</button>
      <button data-action="restore">Restore point 1</button></div>
    <p class="demo-note">Resize + preserve copies surviving GPU records. Replace all positions uses supplied coordinates/presence
      and retains registered pins.
      Hiding preserves the last coordinates and leaves an index gap. These are storage primitives; animated transitions are separate.</p>
    <p data-output="cleanup" class="demo-note"></p>
    <h3>Resize cost and buffer footprint</h3><p class="demo-note">Peak includes old + new explicitly tracked application buffers.
      These counters exclude driver allocation, pipeline/texture memory and internal staging/uniform buffers.
      Exact-size generations rebuild on every count change.</p>
    <div data-output="resizes" class="many-body-results"></div>
    <h3>First frame after each update</h3><p class="demo-note">GPU work sums paired compute/render pass timestamps.
      One evolved frame per row, including first-use effects;
      this is a resize diagnostic, not a steady-state FPS benchmark. CPU reference evaluation and validation are outside the measured frame.</p>
    <div data-output="frames" class="many-body-results"></div>`
  const el = <T extends HTMLElement>(q: string): T => host.querySelector<T>(q)!
  const button = (name: string): HTMLButtonElement => el(`[data-action="${name}"]`)
  const control = (name: string): HTMLSelectElement => el(`[data-control="${name}"]`)
  const status = el('[data-output="status"]')
  let session: CapacitySession | undefined; let destroyed = false; let busy = false; let stopped = false; let error: string | undefined
  let active: Settings; const cleanups: number[][] = []
  const controls = (): void => {
    host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, select, input').forEach(c => { c.disabled = busy })
    button('stop').disabled = !busy
    for (const action of ['step', 'cycle', 'resize', 'replace', 'pin', 'hide', 'restore']) button(action).disabled = busy || !session || !!error
    button('export').disabled = busy || !session || (!session.rows.length && !session.resizes.length && !session.edits.length && !error)
  }
  const render = (): void => {
    if (destroyed || !session) return
    session.render()
    session.lanes.forEach((l, i) => { el(`[data-output="memory-${i}"]`).textContent = `${l.count.toLocaleString()} points · ${mib(l.footprint().bytes)} MiB` })
    el('[data-output="resizes"]').innerHTML = session.resizes.length
      ? `<table><thead><tr><th>Points</th><th>Path</th><th>Completion ms</th>
      <th>Read MiB</th><th>Copy MiB</th><th>Position upload MiB</th><th>Live MiB</th><th>Peak MiB</th><th>Result</th></tr></thead>
      <tbody>${session.resizes.flatMap(row =>
    row.reports.map((r, i) => `<tr><td>${r.from} → ${r.count}${r.preserve ? '' : ' · replace'}</td><td>${i ? 'GPU' : 'CPU'}</td>
      <td>${r.completionMs.toFixed(2)}</td><td>${mib(r.downloadedBytes)}</td><td>${mib(r.copiedBytes)}</td><td>${mib(r.uploadedBytes)}</td>
      <td>${mib(r.after.bytes)}</td><td>${mib(r.peakBytes)}</td><td>${row.valid ? 'Pass · same device' : 'FAIL'}</td></tr>`)).join('')}</tbody></table>`
      : ''
    el('[data-output="frames"]').innerHTML = session.rows.length
      ? `<table><thead><tr><th>Tick</th><th>Points</th><th>Position / force bit differences</th>
      <th>CPU failures</th><th>GPU work ms</th><th>CPU submit ms</th><th>Completion ms</th><th>Result</th></tr></thead><tbody>${session.rows.map(r =>
    `<tr><td>${r.tick}</td><td>${r.count}</td><td>${r.positions} / ${r.forces}</td><td>${r.cpu?.failures ?? 'Not checked'}</td>
      <td>${r.timing.batchGpuMs?.toFixed(3) ?? r.timing.timerStatus}</td><td>${r.timing.batchSubmitMs.toFixed(3)}</td>
      <td>${r.timing.batchCompletionMs.toFixed(3)}</td>
      <td>${r.valid ? r.cpu ? 'Pass' : 'Dataflow pass · CPU skipped' : 'FAIL'}</td></tr>`).join('')}</tbody></table>`
      : ''
  }
  const reset = async (): Promise<void> => {
    busy = true
    if (session) { session.destroy(); cleanups.push(session.lanes.map(l => l.footprint().bytes)) }
    session = undefined; error = undefined; controls(); button('stop').disabled = true
    for (const name of ['resizes', 'frames']) el(`[data-output="${name}"]`).replaceChildren()
    active = { fixture: control('fixture').value as Fixture, count: 2048, decay: 100, springPrecision: 'trig' }
    status.textContent = 'Preparing 2,048-point lanes…'
    try {
      const next = await createCapacitySession(active, i => el(`[data-lane="${i}"]`))
      if (destroyed) { next.destroy(); return }
      session = next; next.lanes.forEach((l, i) => { el(`[data-output="info-${i}"]`).textContent = l.info })
      render(); status.textContent = 'Ready. Run the cycle or apply edits before resizing.'
      el('[data-output="cleanup"]').textContent = cleanups.length
        ? `Previous session cleanup: ${cleanups.at(-1)!.join(' / ')} tracked buffer bytes remain.`
        : ''
    } catch (e) { if (!destroyed) { error = String(e); status.textContent = error } } finally { busy = false; if (!destroyed) controls() }
  }
  const step = async (): Promise<void> => {
    const row = await session!.step(el<HTMLInputElement>('[data-control="cpu"]').checked)
    if (destroyed) return
    render()
    if (!row.valid) throw new Error(`Validation failed at tick ${row.tick}; inspect the row and export`)
  }
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy || !session) return
    busy = true; stopped = false; controls()
    try { await work() } catch (e) { if (!destroyed) { error = String(e); status.textContent = error } } finally { busy = false; if (!destroyed) controls() }
  }
  button('step').addEventListener('click', () => run(async () => {
    status.textContent = 'Checking the next evolved frame…'; await step()
    if (!destroyed) status.textContent = `Tick ${session!.tick()} validated at ${session!.lanes[0].count.toLocaleString()} points.`
  }))
  for (const action of ['resize', 'replace']) {
    button(action).addEventListener('click', () => run(async () => {
      status.textContent = 'Preparing replacement buffers and transferring positions…'
      const row = await session!.resize(Number(control('target').value), action === 'resize')
      if (destroyed) return
      render(); if (!row.valid) throw new Error('Resize data preservation failed')
      status.textContent = `Resize passed at tick ${session!.tick()}; devices and cooling retained. Step + validate to check the new count.`
    }))
  }
  for (const action of ['pin', 'hide', 'restore']) {
    button(action).addEventListener('click', () => run(async () => {
      if (action === 'pin') session!.patch(0, new Float32Array([-32, 16, 1, 0]))
      else session!.absent(1, action === 'hide')
      render(); status.textContent = `Edit applied at tick ${session!.tick()}. Continue or resize to check preservation.`
    }))
  }
  button('cycle').addEventListener('click', () => run(async () => {
    const repeats = Number(control('repeats').value)
    for (let cycle = 0; cycle < repeats; cycle++) {
      for (const count of CAPACITY_CYCLE) {
        if (stopped || destroyed) break
        status.textContent = `Cycle ${cycle + 1}/${repeats}: resizing to ${count.toLocaleString()} points…`
        const row = await session!.resize(count)
        if (destroyed) return
        if (!row.valid) throw new Error('Resize data preservation failed')
        await step(); await new Promise(resolve => requestAnimationFrame(resolve))
      }
      if (stopped || destroyed) break
    }
    if (!destroyed) {
      status.textContent = `${stopped ? 'Stopped' : 'Finished'} at tick ${session!.tick()}; ` +
      `${session!.resizes.length} resize checks retained. Each valid row kept the same devices and cooling.`
    }
  }))
  button('stop').addEventListener('click', () => { stopped = true })
  button('reset').addEventListener('click', () => { if (!busy) reset().catch(() => {}) })
  control('fixture').addEventListener('change', () => { if (!busy) reset().catch(() => {}) })
  button('export').addEventListener('click', () => {
    if (!session) return
    const report = {
      experiment: 'point-capacity',
      gpuApi: 'luma',
      settings: active,
      browser: navigator.userAgent,
      info: session.lanes.map(l => l.info),
      cycle: CAPACITY_CYCLE,
      tick: session.tick(),
      alpha: session.alpha(),
      resizes: session.resizes,
      rows: session.rows,
      edits: session.edits,
      footprints: session.lanes.map(l => l.footprint()),
      cleanups,
      error,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `cosmos-point-capacity-${Date.now()}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  await reset()
  return { destroy (): void { destroyed = true; stopped = true; session?.destroy() } }
}
