import type { ExperimentInstance } from '../../runtime/experiment'
import { createControlledProfiler, profileSummary, PROFILE_POLICY, type ControlledProfiler } from '../combined-layout/controlled-profile'
import { PROFILE_STAGES } from '../combined-layout/stage-timing'
import type { Fixture } from '../combined-layout/data'
const labels = [
  'Gravity force', 'Gravity integration', 'Bounds + frame', 'Grid clear + binning', 'Grid aggregates',
  'Sample selection', 'Centroid correction', 'Far contributions + accumulation', 'Resolve repulsion', 'Repulsion integration',
  'Incoming springs', 'Incoming integration', 'Outgoing springs', 'Outgoing integration', 'Draw circles + links',
]
const names = ['GPU rebuild', 'GPU retained capacity']
const number = (n: number | null): string => n === null ? 'Unavailable' : n.toFixed(3)
export async function createProfileView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<p class="demo-note">One frozen input per run: positions, topology, samples, alpha, tick/seed and camera stay fixed.
    Normal frames keep one simulation pass; diagnostic profiles use 15 passes. Their times are shown separately.</p>
    <div class="scale-toolbar"><label>Graph <select data-control="fixture"><option>chain</option><option>communities</option>
      <option>star</option></select></label>
      <label>Logical points <select data-control="count"><option>4096</option><option selected>8192</option></select></label>
      <label>Input state <select data-control="history"><option value="resized" selected>After resize history</option>
        <option value="initial">Initial fixture · control</option></select></label></div>
    <p class="demo-note">${PROFILE_POLICY.warmups} warmup rounds + ${PROFILE_POLICY.samples} measured rounds.
      Each round balances rebuilt/retained resources and normal/profile timing. Keep this tab visible.
      Both lanes use the strict arithmetic candidate and the unchanged CPU tolerance.</p>
    <div class="controls"><button data-action="run" class="button-primary">Prepare + profile</button><button data-action="stop" disabled>Stop</button>
      <button data-action="reset" disabled>Reset</button><button data-action="export" disabled>Export JSON</button></div>
    <p data-output="status" role="status">Ready. Choose a graph and prepare its frozen input.</p>
    <p data-output="capture" class="demo-note"></p><p data-output="cleanup" class="demo-note"></p>
    <section class="backend-panels">${names.map((name, i) => `<article class="backend-panel"><div class="panel-heading"><h2>${name}</h2>
      <span class="status" data-output="memory-${i}">Not prepared</span></div><canvas data-lane="${i}" width="480" height="340"
      aria-label="${name} fixed-input layout"></canvas></article>`).join('')}</section>
    <h3>Normal frame and diagnostic profile</h3><p class="demo-note">The split-pass sum includes diagnostic pass boundaries.
      It is not a decomposition of the normal single-pass frame. GPU values require all eight valid measured samples.</p>
    <div data-output="frames" class="many-body-results"></div>
    <h3>Diagnostic GPU stages</h3><p class="demo-note">The same kernels and dispatch order run in both modes.
      The repulsion resolve stage includes near-field work and the stored far-field result.
      Very short stages can round to zero at the timer's resolution.
      All position/force bits must match the normal replay; every trial also checks the original independent CPU position tolerance.</p>
    <div data-output="stages" class="many-body-results"></div><p data-output="checks" class="demo-note"></p>`
  const el = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const button = (name: string): HTMLButtonElement => el(`[data-action="${name}"]`)
  const select = (name: string): HTMLSelectElement => el(`[data-control="${name}"]`)
  const status = el('[data-output="status"]')
  let profiler: ControlledProfiler | undefined; let busy = false; let stopped = false; let destroyed = false
  const controls = (): void => {
    host.querySelectorAll<HTMLSelectElement>('select').forEach(s => { s.disabled = busy })
    button('run').disabled = busy; button('stop').disabled = !busy
    button('reset').disabled = busy || !profiler; button('export').disabled = busy || !profiler
  }
  const render = (): void => {
    if (!profiler || destroyed) return
    const r = profiler.report; const c = r.capture
    if (c) {
      el('[data-output="capture"]').textContent = `Frozen input ${c.fingerprint} · tick ${c.tick} · alpha ${c.alpha.toFixed(6)} · ` +
        `${r.settings.count.toLocaleString()} points. Input is restored before each trial; the clock and seed do not advance.`
      c.capacities.forEach((count, i) => {
        el(`[data-output="memory-${i}"]`).textContent = `${count.toLocaleString()} capacity · ${(c.bufferBytes[i] / 1048576).toFixed(3)} MiB`
      })
    }
    el('[data-output="frames"]').innerHTML = `<table><thead><tr><th>Path</th><th>Timing mode</th><th>Samples</th>
      <th>GPU median ms</th><th>GPU range ms</th></tr></thead><tbody>${names.flatMap((name, lane) =>
    (['normal', 'profile'] as const).map(kind => {
      const s = profileSummary(r, lane, kind)
      return `<tr><td>${name}</td><td>${kind === 'normal' ? 'Normal · 2 passes' : 'Diagnostic · 15 passes'}</td>
        <td>${s.samples}/8</td><td>${number(s.gpuMs)}</td><td>${s.range?.map(n => n.toFixed(3)).join('–') ?? 'Unavailable'}</td></tr>`
    })).join('')}</tbody></table>`
    el('[data-output="stages"]').innerHTML = `<table><thead><tr><th>Stage</th><th>Rebuild ms</th><th>Rebuild range</th>
      <th>Retained ms</th><th>Retained range</th></tr></thead><tbody>${PROFILE_STAGES.map((name, i) => {
    const a = profileSummary(r, 0, 'profile', name); const b = profileSummary(r, 1, 'profile', name)
    return `<tr><td>${labels[i]}</td><td>${number(a.gpuMs)}</td><td>${a.range?.map(n => n.toFixed(3)).join('–') ?? '—'}</td>
        <td>${number(b.gpuMs)}</td><td>${b.range?.map(n => n.toFixed(3)).join('–') ?? '—'}</td></tr>`
  }).join('')}</tbody></table>`
    const checks = r.trials.filter(t => t.check.valid).length
    el('[data-output="checks"]').textContent = `${checks}/${r.trials.length} trial checks pass · ` +
      `${r.anchors?.filter(c => c.valid).length ?? 0}/2 normal anchors pass · ` +
      `${r.preparation?.frames ?? 0} checked preparation frames. Partial runs do not produce complete GPU medians.`
  }
  const dispose = (): void => {
    if (!profiler) return
    profiler.destroy()
    el('[data-output="cleanup"]').textContent = `Previous run cleanup: ${profiler.remainingBytes().join(' / ')} tracked buffer bytes remain.`
    profiler = undefined
  }
  button('run').addEventListener('click', async () => {
    if (busy) return
    dispose(); busy = true; stopped = false; controls()
    for (const name of ['capture', 'frames', 'stages', 'checks']) el(`[data-output="${name}"]`).replaceChildren()
    status.textContent = 'Creating the two GPU lanes…'
    try {
      const next = await createControlledProfiler({
        fixture: select('fixture').value as Fixture,
        count: Number(select('count').value),
        peakCount: 8192,
        history: select('history').value === 'resized',
      }, i => el(`[data-lane="${i}"]`))
      if (destroyed) { next.destroy(); return }
      profiler = next
      await next.run({
        cancelled: () => stopped || destroyed || document.hidden,
        progress: message => { if (!destroyed) { status.textContent = message; render() } },
      })
      if (destroyed) return
      render(); status.textContent = next.report.status === 'complete'
        ? 'Finished. All frozen-input trials passed the unchanged checks.'
        : next.report.status === 'cancelled' ? 'Stopped. Partial results are available for export.' : `Failed: ${next.report.error}`
    } catch (error) { if (!destroyed) status.textContent = String(error) } finally { busy = false; if (!destroyed) controls() }
  })
  button('stop').addEventListener('click', () => { stopped = true })
  for (const name of ['fixture', 'count', 'history']) {
    select(name).addEventListener('change', () => {
      if (profiler && !busy) status.textContent = 'Settings changed. Prepare + profile to measure them; the displayed results belong to the previous run.'
    })
  }
  button('reset').addEventListener('click', () => {
    if (busy) return
    dispose(); for (const name of ['capture', 'frames', 'stages', 'checks']) el(`[data-output="${name}"]`).replaceChildren()
    status.textContent = 'Ready. Choose a graph and prepare its frozen input.'; controls()
  })
  button('export').addEventListener('click', () => {
    if (!profiler) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(profiler.report, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `cosmos-gpu-stage-profile-${Date.now()}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  return { destroy (): void { destroyed = true; stopped = true; profiler?.destroy() } }
}
