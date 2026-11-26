import type { ExperimentInstance } from '../../runtime/experiment'
import { count as formatCount, milliseconds } from '../../runtime/result-format'
import { disposeRunLayout, mountRunLayout } from '../../runtime/run-layout'
import type { Fixture, Settings } from '../combined-layout/data'
import { benchmarkResidentFrames, FRAME_POLICY, type FrameTimingRow } from '../combined-layout/frame-benchmark'

const graphNames = { chain: 'Chain', communities: 'Communities', star: 'Star', pinned: 'Pinned' } satisfies Partial<Record<Fixture, string>>
type TimingSettings = Pick<Settings, 'count' | 'decay'> & { fixture: keyof typeof graphNames }

function renderTimings (host: HTMLElement, rows: readonly FrameTimingRow[], settings: TimingSettings): void {
  host.innerHTML = `<h2>Time per frame</h2>
    <p class="demo-note">This run · ${graphNames[settings.fixture]} · ${formatCount(settings.count)} points · ${settings.decay} cooling steps</p>
    <div class="many-body-results"><table><thead><tr><th>Workload</th><th>GPU median and range (ms)</th>
    <th>CPU submit (ms)</th><th>Through GPU completion (ms)</th></tr></thead><tbody>${rows.map(row => {
    const workload = `${row.mode === 'trig' ? 'Refined' : 'Native f32'} · ${row.draw ? 'Simulation and drawing' : 'Simulation'}`
    if (row.error) return `<tr><td>${workload}</td><td colspan="3">Unavailable · GPU or replay error</td></tr>`
    if (row.samples.length < FRAME_POLICY.samples) {
      return `<tr><td>${workload}</td><td colspan="3">${row.samples.length} of ${FRAME_POLICY.samples} samples</td></tr>`
    }
    const summary = row.summary
    const range = summary?.gpuRange?.map(milliseconds).join('–')
    return `<tr><td>${workload}</td><td>${milliseconds(summary?.gpuMs)}${range ? `<br><small>${range}</small>` : ''}</td>
      <td>${milliseconds(summary?.submitMs)}</td><td>${milliseconds(summary?.completionMs)}</td></tr>`
  }).join('')}</tbody></table></div>`
}

export function createTimingView (host: HTMLElement): ExperimentInstance {
  host.innerHTML = `<div class="scale-toolbar" data-run-part="configuration">
    <label>Graph <select data-graph>${Object.entries(graphNames).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
    <label>Points <select data-count><option>128</option><option>512</option><option>2048</option><option>8192</option></select></label>
    <label>Cooling steps <select data-decay><option>20</option><option>100</option><option>300</option></select></label>
  </div>
  <div class="controls">
    <button data-measure class="button-primary" data-run-action="primary">Measure frame time</button>
    <button data-stop data-run-action="primary" hidden>Stop</button>
  </div>
  <p role="status" data-run-part="status" data-output="status"></p>
  <section id="run-results" aria-label="Frame timing results" hidden>
    <div data-timings></div><button data-export>Export samples</button>
  </section>`
  mountRunLayout(host)
  const run = host.querySelector<HTMLButtonElement>('[data-measure]')!
  const stop = host.querySelector<HTMLButtonElement>('[data-stop]')!
  const report = host.querySelector<HTMLElement>('#run-results')!
  const status = host.querySelector<HTMLElement>('[data-output="status"]')!
  const download = host.querySelector<HTMLButtonElement>('[data-export]')!
  const fixture = host.querySelector<HTMLSelectElement>('[data-graph]')!
  const count = host.querySelector<HTMLSelectElement>('[data-count]')!
  const decay = host.querySelector<HTMLSelectElement>('[data-decay]')!
  host.querySelector('#run-run')!.after(report)
  host.querySelector('#run-run')!.setAttribute('aria-label', 'Frame timing')
  let busy = false
  let stopped = false
  let destroyed = false
  let lastRun: { settings: TimingSettings; rows: FrameTimingRow[]; stopped: boolean; error?: string } | undefined

  run.addEventListener('click', async () => {
    if (busy) return
    busy = true; stopped = false
    run.disabled = fixture.disabled = count.disabled = decay.disabled = true
    stop.hidden = false; stop.disabled = false
    report.hidden = true
    const settings: TimingSettings = {
      fixture: fixture.value as TimingSettings['fixture'],
      count: Number(count.value),
      decay: Number(decay.value),
    }
    const rows: FrameTimingRow[] = []
    let error: string | undefined
    status.textContent = 'Preparing the timing run…'
    try {
      await benchmarkResidentFrames({
        settings,
        rows,
        cancelled: () => stopped || destroyed,
        progress: message => { if (!destroyed && !stopped) status.textContent = message },
      })
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure)
    }
    if (destroyed) return
    lastRun = { settings, rows, stopped, error }
    const unavailable = rows.some(row => row.error)
    status.textContent = error ?? (stopped ? 'Timing stopped.' : unavailable ? 'Some workloads could not be measured.' : '')
    if (rows.length) {
      renderTimings(report.querySelector('[data-timings]')!, rows, settings)
      report.hidden = false
    }
    busy = false
    run.disabled = fixture.disabled = count.disabled = decay.disabled = false
    stop.hidden = true
  })
  const cancel = (): void => {
    if (!busy) return
    stopped = true
    stop.disabled = true
    status.textContent = 'Stopping after the current batch…'
  }
  stop.addEventListener('click', cancel)
  download.addEventListener('click', () => {
    if (!lastRun) return
    const blob = new Blob([JSON.stringify({
      experiment: 'resident-frame-timing',
      gpuApi: 'luma',
      browser: navigator.userAgent,
      framePolicy: FRAME_POLICY,
      ...lastRun,
    }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `cosmos-resident-frame-timing-${Date.now()}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  return { pause: cancel, destroy (): void { destroyed = true; disposeRunLayout(host) } }
}
