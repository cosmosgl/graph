import type { ExperimentInstance } from '../../runtime/experiment'
import { createGridStudy, type GridStudy, type GridCase } from '../combined-layout/grid-study'
import { FROZEN_POLICY, frozenSummary, frozenPairedWins } from '../combined-layout/frozen-timing'
import { PRESETS, type ProductionPreset } from '../combined-layout/production-settings'
const ms = (n: number | null): string => n === null ? 'Unavailable' : n.toFixed(3)
export async function createGridAggregationView (host: HTMLElement, acceptance = false): Promise<ExperimentInstance> {
  host.innerHTML = `<p class="demo-note">${acceptance
    ? 'Validate production’s exact/grid switch and combine hub prefetch with cached grid aggregation. ' +
      'CPU checkpoints validate the evolving layout; normal frames measure the gain.'
    : 'Cache integer membership during binning; keep every floating-point addition in source-index order. ' +
      'Normal frames measure the gain. Diagnostic profiles and cell occupancy explain the work.'}</p>
    <div class="scale-toolbar"><label>Points <select data-control="count">${acceptance ? '<option>4095</option>' : ''}<option>4096</option>
      ${acceptance ? '<option>4097</option>' : ''}<option selected>8192</option></select></label>
      <label>Graph <select data-control="fixture"><option value="chain">Chain</option><option value="communities">Communities</option>
        ${acceptance ? '<option value="star">Star</option>' : ''}</select></label>
      <label>Positions <select data-control="distribution"><option value="uniform">Uniform</option>
        <option value="clusters">Two clusters</option></select></label>
      <label>Input state <select data-control="history"><option value="0">Initial</option><option value="20">After 20 checked ticks</option>
        ${acceptance
    ? `<option value="100">After 100 cooled ticks + full-strength probe</option>
          <option value="300">After 300 cooled ticks + full-strength probe</option>
          <option value="5000">After 5,000 cooled ticks + full-strength probe</option>`
    : ''}</select></label>
      ${acceptance
    ? `<label>Point 0 <select data-control="pinned"><option value="true">Pinned</option>
        <option value="false">Unpinned</option></select></label>`
    : ''}
      ${acceptance
    ? `<label>Physics preset <select data-control="preset">${Object.entries(PRESETS).map(([value, label]) =>
      `<option value="${value}">${label}</option>`).join('')}</select></label>
      <label>CPU checkpoints <select data-control="checkpoint"><option value="1">Every tick</option>
        <option value="10" selected>Every 10 ticks</option><option value="100">Every 100 ticks</option></select></label>`
    : ''}
      <label>Candidate <select data-control="candidate"><option value="cached-small">
        ${acceptance ? 'Hub prefetch + cached grid' : 'Cached IDs + 32-index sort'}</option>
        ${acceptance ? '' : '<option value="cached-cells">Cached IDs + 128-index sort</option>'}
        <option value="baseline">Duplicate baseline</option></select></label></div>
    <div class="controls"><button data-action="compare" class="button-primary">Compare selected</button>
      <button data-action="sweep">${acceptance ? 'Chain + communities + star sweep' : 'Repeat size + density sweep'}</button>
      ${acceptance ? '<button data-action="ladder">100-tick preset ladder</button>' : ''}
      <button data-action="stop" disabled>Stop</button>
      <button data-action="reset" disabled>Reset</button><button data-action="export" disabled>Export JSON</button></div>
    <p data-output="status" role="status">Ready. ${acceptance
    ? 'Production routing: exact at ≤4,096; hierarchy above. The candidate also prefetches hubs at degree ≥1,024.'
    : 'Normal frames and diagnostic profiles run in separate phases.'}</p>
    ${acceptance ? '<p class="demo-note">The preset ladder always runs 100 ticks with ten-tick CPU checkpoints on the selected graph.</p>' : ''}
    <section class="backend-panels"><article class="backend-panel"><div class="panel-heading"><h2>Shared graph</h2>
      <span class="status" data-output="capture">Not prepared</span></div>
      <canvas data-canvas width="480" height="340" aria-label="Shared-device grid comparison"></canvas></article>
      <article class="backend-panel"><h2>Latest normal frame</h2><div data-output="latest"></div>
      <p class="demo-note">${FROZEN_POLICY.warmups} warmup + ${FROZEN_POLICY.samples} measured paired rounds,
        ${FROZEN_POLICY.frames} GPU-restored frames per normal trial. Copies, allocation, readback and CPU work stay outside pass timestamps.</p>
      <p class="demo-note">${acceptance
    ? 'Both lanes use production routing and strict arithmetic. Only the candidate enables hub prefetch and cached aggregation. Point 1 is absent.'
    : 'Point 0 is pinned; point 1 is absent. Both variants keep the same spring implementation.'}
        Membership storage adds one integer per point per level.</p></article></section>
    <p class="demo-note" data-output="cleanup"></p>
    <h3>Normal-frame comparisons</h3><div data-output="results" class="many-body-results"></div>
    <h3>Latest diagnostic costs</h3><p class="demo-note">Separate passes change scheduling. Do not subtract these medians from normal-frame time.</p>
    <div data-output="diagnostic" class="many-body-results"></div>
    <h3>Post-gravity occupancy</h3><p class="demo-note">The baseline scans cells above 128 points.
      The smaller-sort candidate scans above 32 and bounds linked-list traversal. Both preserve source order.</p>
    <div data-output="work" class="many-body-results"></div>`
  const el = <T extends HTMLElement>(q: string): T => host.querySelector<T>(q)!
  const control = (name: string): HTMLSelectElement => el(`[data-control="${name}"]`)
  const button = (name: string): HTMLButtonElement => el(`[data-action="${name}"]`)
  let study: GridStudy | undefined; let busy = false; let stopped = false; let destroyed = false
  const controls = (): void => {
    host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = busy })
    button('compare').disabled = busy; button('sweep').disabled = busy; button('stop').disabled = !busy
    button('reset').disabled = busy || !study; button('export').disabled = busy || !study
    if (acceptance) button('ladder').disabled = busy
  }
  const render = (): void => {
    if (!study || destroyed) return
    const r = study.report; const row = r.rows.at(-1)
    if (row) {
      el('[data-output="capture"]').textContent = `${row.count} ${row.fixture} ${row.distribution} · ` +
        `${row.method} · ${row.activeSamples ?? 8} samples · tick ${row.tick} · alpha ${row.alpha.toPrecision(3)}`
      const normal = [0, 1].map(lane => frozenSummary(row, r.policy, lane, 'normal'))
      el('[data-output="latest"]').innerHTML = `<p>Baseline: <strong>${ms(normal[0].median)} ms</strong></p>
        <p>Candidate: <strong>${ms(normal[1].median)} ms</strong></p>
        <p class="demo-note">${row.trials.reduce((n, t) => n + t.frames.length, 0)} normal frame checks · ${row.stages.length}/4 stage gates ·
          ${row.anchors.length}/2 anchors. ${row.structure ? `Grid bit differences: ${Object.values(row.structure).join(' / ')}.` : ''}</p>
        <p class="demo-note">Independent whole-tick CPU: ${row.wholeCPU ? row.wholeCPU.valid ? 'Pass' : 'FAIL · no timing accepted' : 'Pending'}.</p>`
      if (acceptance) {
        el('[data-output="latest"]').insertAdjacentHTML('beforeend',
          `<p class="demo-note">${row.preparation.length} evolving tick checks · ${row.checkpoints?.length ?? 0} stage checkpoints ·
        ${row.sampling?.length ?? 0} occupancy measurements. Reserved sample capacity: ${row.sampleCapacity ?? 8}.</p>`)
      }
      if (row.method === 'exact') {
        el('[data-output="latest"]').insertAdjacentHTML('beforeend',
          '<p class="demo-note">Exact repulsion builds no grid. Grid occupancy and diagnostic profiles do not apply.</p>')
      }
      el('[data-output="work"]').innerHTML = `<table><thead><tr><th>Grid</th><th>Empty</th><th>Occupied</th><th>Peak</th>
        <th>Scan cells: baseline / candidate</th>
        <th>Source tests: baseline / candidate</th></tr></thead><tbody>${(row.work ?? []).map((w, i) => `<tr><td>${w.grid}²</td><td>${w.empty}</td>
        <td>${w.occupied}</td><td>${w.maxOccupancy}</td><td>${w.dense} / ${row.candidateWork?.[i].dense ?? w.dense}</td>
        <td>${w.denseSourceTests.toLocaleString()} / ${row.candidateWork?.[i].denseSourceTests.toLocaleString() ?? '—'}</td></tr>`).join('')}</tbody></table>`
      el('[data-output="diagnostic"]').innerHTML = `<table><thead><tr><th>Diagnostic</th><th>Baseline ms</th><th>Candidate ms</th></tr></thead>
        <tbody>${[['repulsion.bin', 'Clear + bin'], ['repulsion.aggregate', 'Aggregate'], ['repulsion.samples', 'Samples'],
    ['repulsion.centroids', 'Centroids'], ['repulsion.far', 'Far field']].map(([key, name]) => `<tr><td>${name}</td>${[0, 1].map(lane =>
    `<td>${ms(frozenSummary({ trials: row.diagnostic }, r.policy, lane, 'profile', key).median)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    }
    el('[data-output="results"]').innerHTML = `<table><thead><tr><th>Points</th><th>Graph / positions</th><th>Preset / ticks</th>
      <th>Block</th><th>Baseline ms</th>
      <th>Candidate ms</th><th>Change</th><th>Paired wins</th><th>Checks</th></tr></thead><tbody>${r.rows.map(row => {
    const a = frozenSummary(row, r.policy, 0, 'normal'); const b = frozenSummary(row, r.policy, 1, 'normal'); const wins = frozenPairedWins(row, r.policy)
    const change = a.median && b.median !== null ? `${((b.median / a.median - 1) * 100).toFixed(1)}%` : '—'
    return `<tr><td>${row.count}</td><td>${row.fixture} / ${row.distribution}</td><td>${row.preset ?? 'reference'} / ${row.tick}</td>
      <td>${row.repeat ?? 1}</td><td>${ms(a.median)}</td><td>${ms(b.median)}</td>
      <td>${change}</td><td>${wins === null ? '—' : `${wins}/${r.policy.samples}`}</td>
      <td>${row.error ? 'FAIL' : row.valid ? 'Pass' : r.status === 'cancelled' ? 'Stopped' : 'In progress'}</td></tr>`
  }).join('')}</tbody></table>`
  }
  const retire = (): void => {
    if (!study) return
    study.destroy(); el('[data-output="cleanup"]').textContent = `Cleanup: ${study.remainingBytes().join(' / ')} tracked buffer bytes remain.`
    study = undefined
  }
  const run = async (mode: 'selected' | 'sweep' | 'ladder'): Promise<void> => {
    if (busy) return
    retire(); el('[data-output="cleanup"]').textContent = ''; busy = true; stopped = false; controls()
    for (const name of ['latest', 'results', 'diagnostic', 'work']) el(`[data-output="${name}"]`).replaceChildren()
    const history = Number(control('history').value)
    const selected: GridCase = {
      count: Number(control('count').value),
      fixture: control('fixture').value as GridCase['fixture'],
      distribution: control('distribution').value as GridCase['distribution'],
      historyTicks: history,
      candidate: control('candidate').value as GridCase['candidate'],
      ...(acceptance
        ? {
          repulsionPolicy: 'production',
          springOptimization: control('candidate').value === 'baseline' ? 'baseline' : 'prefetch',
          decay: history >= 100 ? history : 100,
          probe: history >= 100,
          pinned: control('pinned').value === 'true',
          preset: control('preset').value as ProductionPreset,
          checkpointEvery: Number(control('checkpoint').value),
        } as const
        : {}),
    }
    const shapes = acceptance
      ? (['chain', 'communities', 'star'] as const).flatMap(fixture =>
        (['uniform', 'clusters'] as const).map(distribution => ({ ...selected, fixture, distribution })))
      : [4096, 8192].flatMap(count => (['uniform', 'clusters'] as const).map(distribution => ({ ...selected, count, distribution })))
    const cases = mode === 'ladder'
      ? (Object.keys(PRESETS) as ProductionPreset[]).map(preset =>
        ({ ...selected, preset, historyTicks: 100, decay: 100, probe: true, checkpointEvery: 10 }))
      : mode === 'sweep' ? [...shapes.map(s => ({ ...s, repeat: 1 })), ...shapes.reverse().map(s => ({ ...s, repeat: 2 }))] : [selected]
    const status = el('[data-output="status"]'); status.textContent = 'Creating one shared device…'
    try {
      const next = await createGridStudy(el('[data-canvas]'), FROZEN_POLICY, acceptance ? 'layout-acceptance' : 'grid-aggregation')
      if (destroyed) { next.destroy(); return }
      study = next
      await next.run(cases, {
        cancelled: () => stopped || destroyed || document.hidden,
        progress: message => { if (!destroyed) { status.textContent = message; render() } },
      })
      if (destroyed) return
      render(); el('[data-output="cleanup"]').textContent = `Cleanup: ${next.remainingBytes().join(' / ')} tracked buffer bytes remain.`
      status.textContent = next.report.status === 'complete'
        ? 'Finished. All unchanged gates passed.'
        : next.report.status === 'cancelled'
          ? 'Stopped. Export retains partial evidence.'
          : `Finished with ${next.report.rows.filter(row => row.error).length} failed validation case(s). Export retains failure captures.`
    } catch (error) { if (!destroyed) status.textContent = String(error) } finally { busy = false; if (!destroyed) controls() }
  }
  button('compare').addEventListener('click', () => run('selected')); button('sweep').addEventListener('click', () => run('sweep'))
  if (acceptance) button('ladder').addEventListener('click', () => run('ladder'))
  button('stop').addEventListener('click', () => { stopped = true })
  button('reset').addEventListener('click', () => {
    if (busy) return
    retire(); for (const name of ['latest', 'results', 'diagnostic', 'work']) el(`[data-output="${name}"]`).replaceChildren()
    el('[data-output="capture"]').textContent = 'Not prepared'; el('[data-output="status"]').textContent = 'Ready.'; controls()
  })
  for (const c of host.querySelectorAll('select')) {
    c.addEventListener('change', () => {
      if (study) el('[data-output="status"]').textContent = 'Settings changed. Displayed evidence belongs to the previous run.'
    })
  }
  button('export').addEventListener('click', () => {
    if (!study) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(study.report, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url
    a.download = `cosmos-${acceptance ? 'layout-acceptance' : 'grid-aggregation'}-${Date.now()}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  return { destroy (): void { destroyed = true; stopped = true; retire() } }
}
