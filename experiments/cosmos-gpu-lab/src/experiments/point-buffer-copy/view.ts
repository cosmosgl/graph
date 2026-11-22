import { count as formatCount, milliseconds } from '../../runtime/result-format'
import { mountRunLayout, disposeRunLayout, summarizeRun, recordVerdicts, type RunSummary } from '../../runtime/run-layout'
import type { ExperimentInstance } from '../../runtime/experiment'
import { createCapacitySession, type CapacitySession } from '../combined-layout/capacity-session'
import { CAPACITY_CYCLE } from '../combined-layout/capacity'
import type { Fixture, Settings } from '../combined-layout/data'

const experiment = 'point-buffer-copy'
const startCount = 2048
const pointCounts = [startCount, ...CAPACITY_CYCLE].map(formatCount).join(' → ')
const labels = ['Copy through CPU', 'Copy on GPU']
const mib = (bytes: number): string => (bytes / 1048576).toFixed(3)

export async function createBufferCopyView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<p class="demo-note" data-run-part="explanation">The CPU copy downloads the positions of the points that stay and uploads them
      with any new points. The GPU copy moves the positions that stay directly between GPU buffers and uploads only the new points.</p>
    <div data-run-part="configuration" class="scale-toolbar">
        <label>Graph <select data-control="fixture"><option>chain</option><option>communities</option>
        <option>star</option></select></label>
        <label>Number of runs <select data-control="repeats"><option selected>1</option><option>3</option><option>5</option></select></label>
        <label class="checkbox-control"><input data-control="cpu" type="checkbox" checked> Check against CPU</label></div>
    <div class="controls">
      <button data-action="cycle" class="button-primary" data-run-action="primary">Add and remove points</button>
      <button data-action="step" data-run-action="primary">Compare next frame</button>
      <button data-action="reset" data-run-action="primary">Reset / retry</button>
      <button data-action="export" data-run-action="export" disabled>Export JSON</button>
    </div>
    <p data-output="status" role="status" data-run-part="status">Preparing both previews…</p>
    <section data-run-part="visualization" class="backend-panels">${labels.map((name, lane) => `<article class="backend-panel">
      <div class="panel-heading panel-heading-stacked"><h2>${name}</h2>
        <span data-output="memory-${lane}" class="status">Starting</span></div>
      <canvas data-lane="${lane}" width="480" height="340" aria-label="${name} layout"></canvas>
      <p class="demo-note" data-output="info-${lane}"></p>
    </article>`).join('')}</section>
    <p class="demo-note" data-run-part="visualization">Both previews rebuild their WebGPU buffers. After a run, each preview
      shows how much position data it downloaded to the CPU during the last rebuild.</p>
    <p class="demo-note"
      data-run-part="explanation">When the count changes, the demo checks that the points left in the graph keep their data and added points
      get their expected starting data. It then advances both simulations one step and compares point positions and forces.
      These checks happen outside the measured update and frame.</p>
    <section
      data-run-part="diagnostics">
    <h3>Immediate edits</h3><div class="scale-toolbar">
      <label>New point count <select data-control="target"><option>2048</option><option selected>8192</option><option>4096</option></select></label>
      <button data-action="resize"
      data-run-action="diagnostic">Change point count</button>
      <button data-action="replace"
      data-run-action="diagnostic">Replace all positions</button>
      <button data-action="pin"
      data-run-action="diagnostic">Move + pin point 0</button>
      <button data-action="hide"
      data-run-action="diagnostic">Hide point 1</button>
      <button data-action="restore"
      data-run-action="diagnostic">Restore point 1</button></div>
    <p class="demo-note">Change point count keeps the data for points that stay. Replace all positions uses supplied coordinates/presence
      and retains registered pins.
      Hiding preserves the last coordinates and leaves an index gap. These are storage primitives; animated transitions are separate.</p>
    <p data-output="cleanup" class="demo-note"></p>
    </section>
    <h3
      data-run-part="results">Transfer size and rebuild time</h3><p class="demo-note"
      data-run-part="explanation">Peak includes old + new explicitly tracked application buffers.
      These counters exclude driver allocation, pipeline/texture memory and internal staging/uniform buffers.</p>
    <div data-output="resizes" class="many-body-results"
      data-run-part="results"></div>
    <h3
      data-run-part="results">First frame after each update</h3><p class="demo-note"
      data-run-part="explanation">GPU work sums paired compute/render pass timestamps.
      One evolved frame per row, including first-use effects;
      this is a resize diagnostic, not a steady-state FPS benchmark. CPU reference evaluation and validation are outside the measured frame.</p>
    <div data-output="frames" class="many-body-results"
      data-run-part="results"></div>`

  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const button = (name: string): HTMLButtonElement => el(`[data-action="${name}"]`)
  const control = (name: string): HTMLSelectElement => el(`[data-control="${name}"]`)
  const status = el('[data-output="status"]')
  const exportButton = button('export')
  const fixtureControl = control('fixture')
  const repeatsControl = control('repeats')
  const cpuControl = el<HTMLInputElement>('[data-control="cpu"]')
  const cleanups: number[][] = []

  let session: CapacitySession | undefined
  let active: Settings
  let destroyed = false
  let busy = false
  let stopped = false
  let error: string | undefined

  const controls = (): void => {
    host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, select, input').forEach(element => {
      element.disabled = busy
    })
    const unavailable = busy || !session || !!error
    for (const action of host.querySelectorAll<HTMLButtonElement>('[data-action="cycle"], [data-action="step"], [data-run-action="diagnostic"]')) {
      action.disabled = unavailable
    }
    exportButton.disabled = busy || !session || (!session.rows.length && !session.resizes.length && !session.edits.length && !error)
  }
  const renderReadouts = (current: CapacitySession): void => {
    const lastResize = current.resizes.at(-1)
    current.lanes.forEach((lane, index) => {
      const detail = lastResize ? ` · ${lastResize.reports[index].downloadedBytes / 1024} KiB downloaded` : ''
      el(`[data-output="memory-${index}"]`).textContent = `${formatCount(lane.count)} points${detail}`
    })
    el('[data-output="resizes"]').innerHTML = current.resizes.length
      ? `<table><thead><tr><th>Points</th><th>Preview</th>
      <th>Completion (ms)</th><th>Position download (MiB)</th>
      <th>Copy (MiB)</th><th>Position upload (MiB)</th><th>Live (MiB)</th><th>Peak (MiB)</th><th>Result</th></tr></thead>
      <tbody>${current.resizes.flatMap(row =>
    row.reports.map((r, i) => `<tr><td>${r.from} → ${r.count}${r.preserve ? '' : ' · replace'}</td><td>${labels[i]}</td>
      <td>${milliseconds(r.completionMs)}</td><td>${mib(r.downloadedBytes)}</td>
      <td>${mib(r.copiedBytes)}</td><td>${mib(r.uploadedBytes)}</td>
      <td>${mib(r.after.bytes)}</td><td>${mib(r.peakBytes)}</td><td>${row.valid ? 'Pass · same device' : 'Fail'}</td></tr>`)).join('')}</tbody></table>`
      : ''
    el('[data-output="frames"]').innerHTML = current.rows.length
      ? `<table><thead><tr><th>Tick</th><th>Points</th><th>Position / force bit differences</th>
      <th>CPU failures</th><th>Reference GPU (ms)</th><th>Candidate GPU (ms)</th><th>Candidate submit (ms)</th>
      <th>Candidate completion (ms)</th><th>Result</th></tr></thead><tbody>${current.rows.map(r =>
    `<tr><td>${r.tick}</td><td>${formatCount(r.count)}</td><td>${r.positions} / ${r.forces}</td><td>${r.cpu?.failures ?? 'Unchecked'}</td>
      <td>${r.controlTiming ? r.controlTiming.batchGpuMs?.toFixed(3) ?? r.controlTiming.timerStatus : 'Not timed'}</td>
      <td>${r.timing.batchGpuMs?.toFixed(3) ?? r.timing.timerStatus}</td><td>${milliseconds(r.timing.batchSubmitMs)}</td>
      <td>${milliseconds(r.timing.batchCompletionMs)}</td>
      <td>${r.valid ? r.cpu ? 'Pass' : 'Pass · dataflow; CPU unchecked' : 'Fail'}</td></tr>`).join('')}</tbody></table>`
      : ''
  }
  const render = (): void => {
    if (destroyed || !session) return
    session.render()
    renderReadouts(session)
  }
  const reportError = (failure: unknown): void => {
    if (destroyed) return
    error = String(failure)
    status.textContent = error
  }
  const reset = async (): Promise<void> => {
    if (busy || destroyed) return
    busy = true
    try {
      const previous = session
      session = undefined
      if (previous) {
        previous.destroy()
        cleanups.push(previous.lanes.map(lane => lane.footprint().bytes))
      }
      error = undefined
      controls()
      el('[data-output="resizes"]').replaceChildren()
      el('[data-output="frames"]').replaceChildren()
      active = { fixture: fixtureControl.value as Fixture, count: startCount, decay: 100, springPrecision: 'trig' }
      status.textContent = 'Preparing both previews…'

      const next = await createCapacitySession(active, index => el(`[data-lane="${index}"]`), 'transfer')
      if (destroyed) { next.destroy(); return }
      session = next
      next.lanes.forEach((lane, index) => { el(`[data-output="info-${index}"]`).textContent = lane.info })
      render()
      status.textContent = `Point counts per run · ${pointCounts}`
      el('[data-output="cleanup"]').textContent = cleanups.length
        ? `Previous session cleanup: ${cleanups.at(-1)!.join(' / ')} tracked buffer bytes remain.`
        : ''
    } catch (failure) {
      reportError(failure)
    } finally {
      busy = false
      if (!destroyed) controls()
    }
  }
  const step = async (): Promise<void> => {
    const row = await session!.step(cpuControl.checked)
    if (destroyed) return
    render()
    if (!row.valid) throw new Error(`Frame checks failed after step ${row.tick}. See Live results for details.`)
  }
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy || destroyed || !session) return
    busy = true
    stopped = false
    controls()
    try {
      await work()
    } catch (failure) {
      reportError(failure)
    } finally {
      busy = false
      if (!destroyed) controls()
    }
  }

  button('step').addEventListener('click', () => run(async () => {
    status.textContent = 'Advancing both previews one step to compare positions and forces…'
    await step()
    if (!destroyed) status.textContent = `Positions and forces matched after step ${session!.tick()} at ${formatCount(session!.lanes[0].count)} points.`
  }))
  for (const action of ['resize', 'replace']) {
    button(action).addEventListener('click', () => run(async () => {
      status.textContent = action === 'resize' ? 'Changing the point count…' : 'Replacing point positions…'
      const row = await session!.resize(Number(control('target').value), action === 'resize')
      if (destroyed) return
      render()
      if (!row.valid) throw new Error('Point data check failed. See Live results for details.')
      status.textContent = `${formatCount(session!.lanes[0].count)} points. Point data matched the expected result in both previews.`
    }))
  }
  for (const action of ['pin', 'hide', 'restore']) {
    button(action).addEventListener('click', () => run(async () => {
      if (action === 'pin') session!.patch(0, new Float32Array([-32, 16, 1, 0]))
      else session!.absent(1, action === 'hide')
      render()
      status.textContent = `Edit applied at tick ${session!.tick()}; cooling and resident positions retained. ` +
        'Select Compare next frame to check the result.'
    }))
  }
  button('cycle').addEventListener('click', () => run(async () => {
    const current = session!
    const repeats = Number(repeatsControl.value)
    for (let cycle = 0; cycle < repeats; cycle++) {
      for (const count of CAPACITY_CYCLE) {
        if (stopped || destroyed) break
        status.textContent = `Run ${cycle + 1} of ${repeats} · Changing to ${formatCount(count)} points…`
        const row = await current.resize(count)
        if (destroyed) return
        if (!row.valid) throw new Error('Point data check failed. See Live results for details.')
        await step()
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
      if (stopped || destroyed) break
    }
    if (destroyed) return
    status.textContent = stopped
      ? 'Stopped. Completed checks are in Live results.'
      : 'Finished. Both previews matched after each point-count change and the following simulation step.'
  }))
  button('reset').addEventListener('click', reset)
  fixtureControl.addEventListener('change', reset)
  exportButton.addEventListener('click', () => {
    if (!session) return
    const report = {
      experiment,
      gpuApi: 'luma',
      settings: active,
      comparison: session.comparison,
      browser: navigator.userAgent,
      info: session.lanes.map(lane => lane.info),
      cycle: CAPACITY_CYCLE,
      tick: session.tick(),
      alpha: session.alpha(),
      resizes: session.resizes,
      rows: session.rows,
      edits: session.edits,
      footprints: session.lanes.map(lane => lane.footprint()),
      capacities: session.lanes.map(lane => lane.capacity),
      cleanups,
      error,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `cosmos-${experiment}-${Date.now()}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })

  const readSummary = (): RunSummary => summarizeRun(
    busy ? 'Running' : stopped ? 'Stopped' : session ? 'Ready' : 'Preparing',
    [...recordVerdicts(session?.rows ?? []), ...recordVerdicts(session?.resizes ?? [])],
    'Unrun resize histories, total VRAM and device recovery.',
    [],
    error,
    'point-count and frame checks')
  mountRunLayout(host, readSummary, {
    experiment,
    devices: () => session?.lanes.map(lane => lane.info) ?? [],
    secondarySettings: ['[data-control="fixture"]', '[data-control="repeats"]', '[data-control="cpu"]'],
  })
  await reset()
  return {
    pause (): void { stopped = true },
    destroy (): void {
      disposeRunLayout(host)
      destroyed = true
      stopped = true
      session?.destroy()
    },
  }
}
