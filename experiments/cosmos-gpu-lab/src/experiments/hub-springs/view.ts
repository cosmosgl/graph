import type { ExperimentInstance } from '../../runtime/experiment'
import { createHubStudy, hubSummary, HUB_POLICY, type HubCase, type HubStudy } from '../combined-layout/hub-study'
import { hubDegrees } from '../combined-layout/hub-spring-data'
import type { SpringOptimization } from '../combined-layout/hub-spring-source'
const ms = (n: number | null): string => n === null ? 'Unavailable' : n.toFixed(3)
export async function createHubView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<p class="demo-note">Keep positions, total links, alpha and seed fixed. A connected broom changes only the hub's degree.
    Compare the strict baseline with a candidate on the same device; both draw the same checked result into one canvas.</p>
    <div class="scale-toolbar"><label>Points <select data-control="count"><option>4096</option><option selected>8192</option></select></label>
      <label>Hub degree <select data-control="degree"></select></label>
      <label>Hub state <select data-control="pinned"><option value="false" selected>Unpinned</option>
        <option value="true">Pinned</option></select></label>
      <label>Candidate <select data-control="candidate"><option value="prefetch" selected>Cooperative prefetch + hoist</option>
        <option value="hoist">Uniform scale hoist only</option></select></label></div>
    <div class="controls"><button data-action="run" class="button-primary">Compare selected</button><button data-action="sweep">Run degree + pin sweep</button>
      <button data-action="stop" disabled>Stop</button><button data-action="reset" disabled>Reset</button>
      <button data-action="export" disabled>Export JSON</button></div>
    <p data-output="status" role="status">Ready. Start with the unpinned full star, or sweep both hub states.</p>
    <p class="demo-note">${HUB_POLICY.warmups} warmup + ${HUB_POLICY.samples} measured rounds; ${HUB_POLICY.frames} restored frames per trial.
      Trial order balances baseline/candidate and normal/profile methods. Every frame keeps the unchanged CPU tolerance and exact replay gate.</p>
    <section class="backend-panels"><article class="backend-panel"><div class="panel-heading"><h2>Frozen graph</h2>
      <span class="status" data-output="capture">Not prepared</span></div>
      <canvas data-canvas width="480" height="340" aria-label="Shared-device hub comparison"></canvas>
      </article><article class="backend-panel"><h2>Latest comparison</h2><div data-output="latest"></div>
      <p class="demo-note">Normal frame GPU time includes the existing single compute pass and drawing.
        Diagnostic spring timings use split passes. A faster isolated pass must also improve the normal frame.</p>
      <p class="demo-note">Prefetch loads 64 consecutive neighbors at a time; one invocation applies their corrections in the original order.
        The hoist control only moves the uniform scale outside the loop. Neither replaces the velocity recurrence with a parallel sum.</p></article></section>
    <p data-output="cleanup" class="demo-note"></p>
    <h3>Degree sweep</h3><p class="demo-note">Edge count stays at point count − 1. Unused spokes become a chain through the remaining points.
      GPU medians average four individually checked frames per trial; ranges are across eight accepted trial means.</p>
    <div data-output="results" class="many-body-results"></div>
    <h3>Latest diagnostic spring cost</h3><p class="demo-note">Split-pass sums are not a decomposition of normal-frame time.
      Small values may round to zero at the timestamp resolution.</p><div data-output="stages" class="many-body-results"></div>`
  const el = <T extends HTMLElement>(q: string): T => host.querySelector<T>(q)!
  const control = (name: string): HTMLSelectElement => el(`[data-control="${name}"]`)
  const button = (name: string): HTMLButtonElement => el(`[data-action="${name}"]`)
  const status = el('[data-output="status"]')
  let study: HubStudy | undefined; let busy = false; let stopped = false; let destroyed = false
  const degrees = (): void => {
    const values = hubDegrees(Number(control('count').value))
    control('degree').innerHTML = values.map(d => `<option>${d}</option>`).join(''); control('degree').value = String(values.at(-1))
  }
  degrees()
  const controls = (): void => {
    host.querySelectorAll<HTMLSelectElement>('select').forEach(c => { c.disabled = busy })
    button('run').disabled = busy; button('sweep').disabled = busy; button('stop').disabled = !busy
    button('reset').disabled = busy || !study; button('export').disabled = busy || !study
  }
  const render = (): void => {
    if (!study || destroyed) return
    const r = study.report; const row = r.rows.at(-1)
    if (row) {
      el('[data-output="capture"]').textContent = `${row.degree} degree · ${row.pinned ? 'pinned' : 'unpinned'} · ${row.fingerprint ?? 'preparing'}`
      const normal = [0, 1].map(i => hubSummary(row, r.policy, i, 'normal'))
      el('[data-output="latest"]').innerHTML = `<p>Baseline: <strong>${ms(normal[0].median)} ms</strong></p>
        <p>Candidate: <strong>${ms(normal[1].median)} ms</strong></p>
        <p class="demo-note">${row.trials.reduce((n, t) => n + t.frames.length, 0)} frozen frame checks ·
          ${row.stages.length}/4 stage gates · ${row.anchors.length}/2 normal anchors.
          All samples are on one device; allocation, uploads, CPU oracle and readback stay outside GPU time.</p>`
      el('[data-output="stages"]').innerHTML = `<table><thead><tr><th>Diagnostic</th><th>Baseline ms</th><th>Candidate ms</th></tr></thead>
        <tbody>${[['incoming.force', 'First spring force'], ['incoming.integration', 'First spring integration'],
    ['outgoing.force', 'Second spring force'], ['outgoing.integration', 'Second spring integration']].map(([key, name]) =>
    `<tr><td>${name}</td><td>${ms(hubSummary(row, r.policy, 0, 'profile', key).median)}</td>
          <td>${ms(hubSummary(row, r.policy, 1, 'profile', key).median)}</td></tr>`).join('')}</tbody></table>`
    }
    el('[data-output="results"]').innerHTML = `<table><thead><tr><th>Degree</th><th>Hub</th><th>Baseline frame ms</th>
      <th>Candidate frame ms</th><th>Observed change</th><th>Baseline range</th><th>Candidate range</th><th>Checks</th></tr></thead><tbody>${r.rows.map(row => {
    const a = hubSummary(row, r.policy, 0, 'normal'); const b = hubSummary(row, r.policy, 1, 'normal')
    const change = a.median && b.median !== null ? `${((b.median / a.median - 1) * 100).toFixed(1)}%` : '—'
    return `<tr><td>${row.degree}</td><td>${row.pinned ? 'Pinned' : 'Unpinned'}</td><td>${ms(a.median)}</td><td>${ms(b.median)}</td>
        <td>${change}</td><td>${a.range?.map(n => n.toFixed(3)).join('–') ?? '—'}</td><td>${b.range?.map(n => n.toFixed(3)).join('–') ?? '—'}</td>
        <td>${row.error ? 'FAIL' : row.valid ? 'Pass' : 'In progress'}</td></tr>`
  }).join('')}</tbody></table>`
  }
  const retire = (): void => {
    if (!study) return
    study.destroy(); el('[data-output="cleanup"]').textContent = `Previous run cleanup: ${study.remainingBytes().join(' / ')} tracked buffer bytes remain.`
    study = undefined
  }
  const run = async (sweep: boolean): Promise<void> => {
    if (busy) return
    retire(); busy = true; stopped = false; controls()
    for (const name of ['latest', 'results', 'stages']) el(`[data-output="${name}"]`).replaceChildren()
    status.textContent = 'Creating one shared GPU device…'
    const count = Number(control('count').value)
    const optimization = control('candidate').value as Exclude<SpringOptimization, 'baseline'>
    const cases: HubCase[] = sweep
      ? hubDegrees(count).flatMap(degree => [false, true].map(pinned => ({ count, degree, pinned, optimization })))
      : [{ count, degree: Number(control('degree').value), pinned: control('pinned').value === 'true', optimization }]
    try {
      const next = await createHubStudy(el('[data-canvas]'))
      if (destroyed) { next.destroy(); return }
      study = next
      await next.run(cases, {
        cancelled: () => stopped || destroyed || document.hidden,
        progress: message => { if (!destroyed) { status.textContent = message; render() } },
      })
      if (destroyed) return
      render(); status.textContent = next.report.status === 'complete'
        ? `Finished. ${next.report.rows.length} case(s) passed the unchanged checks.`
        : next.report.status === 'cancelled' ? 'Stopped. Export retains completed trials.' : `Failed: ${next.report.error}`
    } catch (error) { if (!destroyed) status.textContent = String(error) } finally { busy = false; if (!destroyed) controls() }
  }
  button('run').addEventListener('click', () => run(false))
  button('sweep').addEventListener('click', () => run(true))
  button('stop').addEventListener('click', () => { stopped = true })
  button('reset').addEventListener('click', () => {
    if (busy) return
    retire(); for (const name of ['latest', 'results', 'stages']) el(`[data-output="${name}"]`).replaceChildren()
    el('[data-output="capture"]').textContent = 'Not prepared'; status.textContent = 'Ready.'; controls()
  })
  for (const name of ['count', 'degree', 'pinned', 'candidate']) {
    control(name).addEventListener('change', () => {
      if (name === 'count') degrees()
      if (study && !busy) status.textContent = 'Settings changed. The displayed results belong to the previous run.'
    })
  }
  button('export').addEventListener('click', () => {
    if (!study) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(study.report, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `cosmos-hub-springs-${Date.now()}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  return { destroy (): void { destroyed = true; stopped = true; study?.destroy() } }
}
