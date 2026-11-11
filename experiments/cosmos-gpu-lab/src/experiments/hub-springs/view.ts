import type { ExperimentInstance } from '../../runtime/experiment'
import { createHubStudy, hubSummary, hubPairedWins, HUB_NORMAL_POLICY, type HubCase, type HubStudy, type HubCapture } from '../combined-layout/hub-study'
import { createHubTrajectory, type HubTrajectory, type HubTrajectorySettings } from '../combined-layout/hub-trajectory'
import { hubDegrees } from '../combined-layout/hub-spring-data'
import type { SpringOptimization } from '../combined-layout/hub-spring-source'
const ms = (n: number | null): string => n === null ? 'Unavailable' : n.toFixed(3)
type Mode = 'compare' | 'degree' | 'threshold' | 'trajectory' | 'evolved'
export async function createHubView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<p class="demo-note">Compare ordered spring kernels on one device. Frozen controls keep coordinates and total links fixed.
    Trajectories evolve both variants independently, with checkpoint replay and unchanged CPU tolerances.</p>
    <div class="scale-toolbar"><label>Points <select data-control="count"><option>4096</option><option selected>8192</option></select></label>
      <label>Hub degree <select data-control="degree"></select></label>
      <label>Hub state <select data-control="pinned"><option value="false" selected>Unpinned</option>
        <option value="true">Pinned</option></select></label>
      <label>Candidate <select data-control="candidate"><option value="prefetch" selected>Cooperative prefetch + hoist</option>
        <option value="hoist">Uniform scale hoist only</option></select></label>
      <label>Prefetch threshold <select data-control="threshold"><option>64</option><option selected>1024</option><option>4096</option>
        <option>8192</option></select></label>
      <label>Trajectory ticks <select data-control="decay"><option selected>100</option><option>300</option></select></label></div>
    <div class="controls"><button data-action="compare" class="button-primary">Compare selected</button>
      <button data-action="degree">Run degree + pin sweep</button><button data-action="threshold">Repeat threshold controls</button>
      <button data-action="trajectory">Validate trajectory</button></div>
    <div class="controls"><label>Final-geometry strength <select data-control="capture"><option value="probe" selected>Full-strength probe</option>
      <option value="cooled">End of cooling</option></select></label><button data-action="evolved" disabled>Benchmark final geometry</button>
      <button data-action="stop" disabled>Stop</button><button data-action="reset" disabled>Reset</button>
      <button data-action="export" disabled>Export JSON</button></div>
    <p data-output="status" role="status">Ready. Compare frozen inputs or validate an evolving trajectory first.</p>
    <p class="demo-note">Timing: ${HUB_NORMAL_POLICY.warmups} warmup + ${HUB_NORMAL_POLICY.samples} measured paired rounds,
      ${HUB_NORMAL_POLICY.frames} restored frames per trial. Frames queue without per-frame CPU waits; only ordinary compute + render passes are timed.
      Trajectory checkpoints run at tick 1, every 10 ticks and the last tick, followed by a restoring full-strength probe.</p>
    <section class="backend-panels"><article class="backend-panel"><div class="panel-heading"><h2>Shared graph</h2>
      <span class="status" data-output="capture">Not prepared</span></div>
      <canvas data-canvas width="480" height="340" aria-label="Shared-device hub comparison"></canvas></article>
      <article class="backend-panel"><h2>Latest comparison</h2><div data-output="latest"></div>
      <p class="demo-note">One invocation applies each hub's corrections in CSR order. Other invocations prefetch neighbors.
        Directions without hubs use the unchanged plain kernel. The threshold is an experiment control, not a production policy.</p>
      <p class="demo-note">Timing a final full-strength probe measures one restoring tick on evolved geometry;
        it does not measure the cooled trajectory's average frame time.</p></article></section>
    <p data-output="cleanup" class="demo-note"></p>
    <h3>Timing comparisons</h3><p class="demo-note">Threshold controls repeat the selected degree and pin state in two blocks, reversing threshold order.
      Wins count paired rounds with lower candidate GPU time. GPU restore/capture copies stay outside the pass timestamps.
      JSON retains every frame check and GPU duration.</p>
    <div data-output="results" class="many-body-results"></div>
    <h3>Trajectory checkpoints</h3><div data-output="trajectory" class="many-body-results"></div>`
  const el = <T extends HTMLElement>(q: string): T => host.querySelector<T>(q)!
  const control = (name: string): HTMLSelectElement => el(`[data-control="${name}"]`)
  const button = (name: string): HTMLButtonElement => el(`[data-action="${name}"]`)
  const status = el('[data-output="status"]')
  let study: HubStudy | undefined; let trajectory: HubTrajectory | undefined
  let evolved: { settings: HubTrajectorySettings; probe: HubCapture; cooled: HubCapture } | undefined
  let exported: HubStudy['report'] | HubTrajectory['report'] | undefined
  let busy = false; let stopped = false; let destroyed = false
  const degrees = (): void => {
    const values = hubDegrees(Number(control('count').value))
    control('degree').innerHTML = values.map(d => `<option>${d}</option>`).join(''); control('degree').value = String(values.at(-1))
  }
  degrees()
  const controls = (): void => {
    const prefetch = control('candidate').value === 'prefetch'
    host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = busy })
    control('threshold').disabled = busy || !prefetch; control('capture').disabled = busy || !evolved
    for (const mode of ['compare', 'degree', 'threshold', 'trajectory']) button(mode).disabled = busy || (!prefetch && mode !== 'compare' && mode !== 'degree')
    button('evolved').disabled = busy || !evolved; button('stop').disabled = !busy
    button('reset').disabled = busy || !exported; button('export').disabled = busy || !exported
  }
  const render = (): void => {
    if (!study || destroyed) return
    const r = study.report; const row = r.rows.at(-1)
    if (row) {
      el('[data-output="capture"]').textContent = `Degree ${row.degree} · seed ${row.tick} · alpha ${row.alpha.toPrecision(3)}`
      const normal = [0, 1].map(i => hubSummary(row, r.policy, i, 'normal'))
      el('[data-output="latest"]').innerHTML = `<p>Baseline: <strong>${ms(normal[0].median)} ms</strong></p>
        <p>Candidate: <strong>${ms(normal[1].median)} ms</strong></p>
        <p class="demo-note">Ranges: ${normal.map(s => s.range?.map(n => n.toFixed(3)).join('–') ?? 'pending').join(' / ')} ms.</p>
        <p class="demo-note">${row.trials.reduce((n, t) => n + t.frames.length, 0)} restored frame checks ·
          ${row.stages.length}/4 stage gates · ${row.anchors.length}/2 anchors.
          Allocation, uploads, CPU work and readback stay outside GPU time.</p>`
    }
    el('[data-output="results"]').innerHTML = `<table><caption>${r.rows[0]?.count ?? '—'} points · frozen normal frames</caption>
      <thead><tr><th>Degree</th><th>Hub</th><th>Threshold</th><th>Block</th>
      <th>Baseline ms</th><th>Candidate ms</th><th>Change</th><th>Paired wins</th><th>Checks</th></tr></thead><tbody>${r.rows.map(row => {
    const a = hubSummary(row, r.policy, 0, 'normal'); const b = hubSummary(row, r.policy, 1, 'normal')
    const change = a.median && b.median !== null ? `${((b.median / a.median - 1) * 100).toFixed(1)}%` : '—'
    const wins = hubPairedWins(row, r.policy)
    return `<tr><td>${row.degree}</td><td>${row.pinned ? 'Pinned' : 'Unpinned'}</td><td>${row.threshold}</td><td>${row.repeat ?? 1}</td>
      <td>${ms(a.median)}</td><td>${ms(b.median)}</td><td>${change}</td><td>${wins === null ? '—' : `${wins}/${r.policy.samples}`}</td>
      <td>${row.error ? 'FAIL' : row.valid ? 'Pass' : 'In progress'}</td></tr>`
  }).join('')}</tbody></table>`
  }
  const renderTrajectory = (): void => {
    if (!trajectory || destroyed) return
    const r = trajectory.report
    el('[data-output="capture"]').textContent = `Degree ${r.settings.degree} · trajectory tick ${r.tick}/${r.settings.decay}`
    el('[data-output="latest"]').textContent = `${r.checkpoints.filter(c => c.valid).length}/${r.checkpoints.length} checkpoints pass. ` +
      'Exact stage/normal replay, original spring CPU budget and whole-tick CPU budget.'
    el('[data-output="trajectory"]').innerHTML = `<table><caption>${r.settings.count} points · degree ${r.settings.degree} ·
      ${r.settings.pinned ? 'pinned' : 'unpinned'} · threshold ${r.settings.threshold}</caption>
      <thead><tr><th>Tick</th><th>Alpha</th><th>GPU stage replay</th>
      <th>CPU stages</th><th>Normal + whole CPU</th></tr></thead><tbody>${r.checkpoints.map(c => `<tr>
      <td>${c.probe ? 'Final probe' : c.tick}</td><td>${c.alpha.toPrecision(3)}</td>
      <td>${c.stages.length === 4 && c.stages.every(s => !s.positions && !s.forces) ? 'Exact' : 'Pending / fail'}</td>
      <td>${c.stages.length === 4 && c.stages.every(s => s.cpu.every(l => l.positions.valid && l.forces.valid)) ? 'Pass' : 'Pending / fail'}</td>
      <td>${c.valid ? 'Pass' : 'Pending / fail'}</td></tr>`).join('')}</tbody></table>`
  }
  const retire = (): void => {
    for (const owner of [study, trajectory]) {
      if (!owner) continue
      owner.destroy(); el('[data-output="cleanup"]').textContent = `Cleanup: ${owner.remainingBytes().join(' / ')} tracked buffer bytes remain.`
    }
    study = undefined; trajectory = undefined
  }
  const run = async (mode: Mode): Promise<void> => {
    if (busy) return
    retire(); busy = true; stopped = false; controls()
    for (const name of ['latest', 'results']) el(`[data-output="${name}"]`).replaceChildren()
    status.textContent = 'Creating one shared GPU device…'; exported = undefined
    const settings: HubTrajectorySettings = {
      count: Number(control('count').value),
      degree: Number(control('degree').value),
      pinned: control('pinned').value === 'true',
      threshold: Number(control('threshold').value),
      decay: Number(control('decay').value),
      checkpointEvery: 10,
    }
    const cancelled = (): boolean => stopped || destroyed || document.hidden
    try {
      if (mode === 'trajectory') {
        evolved = undefined; el('[data-output="trajectory"]').replaceChildren()
        const next = await createHubTrajectory(el('[data-canvas]'), settings)
        if (destroyed) { next.destroy(); return }
        trajectory = next; exported = next.report
        await next.run({ cancelled, progress: message => { if (!destroyed) { status.textContent = message; renderTrajectory() } } })
        if (destroyed) return
        renderTrajectory()
        if (next.report.status === 'complete') evolved = { settings, probe: next.finalCapture(true), cooled: next.finalCapture(false) }
      } else {
        const optimization = control('candidate').value as Exclude<SpringOptimization, 'baseline'>
        const selected: HubCase = { ...settings, optimization }
        const thresholds = [64, 1024, 4096, 8192]
        const cases: HubCase[] = mode === 'degree'
          ? hubDegrees(settings.count).flatMap(degree => [false, true].map(pinned => ({ ...selected, degree, pinned })))
          : mode === 'threshold'
            ? [1, 2].flatMap(repeat => (repeat === 1 ? thresholds : [...thresholds].reverse())
              .map(threshold => ({ ...selected, threshold, repeat })))
            : [selected]
        const next = await createHubStudy(el('[data-canvas]'), HUB_NORMAL_POLICY)
        if (destroyed) { next.destroy(); return }
        study = next; exported = next.report
        await next.run(cases, {
          cancelled,
          capture: mode === 'evolved' ? evolved?.[control('capture').value === 'probe' ? 'probe' : 'cooled'] : undefined,
          progress: message => { if (!destroyed) { status.textContent = message; render() } },
        })
        if (destroyed) return
        render()
      }
      const r = exported!
      status.textContent = r.status === 'complete'
        ? 'Finished. All unchanged validation gates passed.'
        : r.status === 'cancelled' ? 'Stopped. Export retains partial evidence.' : `Failed: ${r.error}`
    } catch (error) { if (!destroyed) status.textContent = String(error) } finally { busy = false; if (!destroyed) controls() }
  }
  for (const mode of ['compare', 'degree', 'threshold', 'trajectory', 'evolved'] as const) button(mode).addEventListener('click', () => run(mode))
  button('stop').addEventListener('click', () => { stopped = true })
  button('reset').addEventListener('click', () => {
    if (busy) return
    retire(); evolved = undefined; exported = undefined
    for (const name of ['latest', 'results', 'trajectory']) el(`[data-output="${name}"]`).replaceChildren()
    el('[data-output="capture"]').textContent = 'Not prepared'; status.textContent = 'Ready.'; controls()
  })
  for (const name of ['count', 'degree', 'pinned', 'candidate', 'threshold', 'decay']) {
    control(name).addEventListener('change', () => {
      if (name === 'count') degrees()
      evolved = undefined
      if (exported) status.textContent = 'Settings changed. Displayed evidence belongs to the previous run.'
      controls()
    })
  }
  button('export').addEventListener('click', () => {
    if (!exported) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `cosmos-${exported.experiment}-${Date.now()}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  controls()
  return { destroy (): void { destroyed = true; stopped = true; retire() } }
}
