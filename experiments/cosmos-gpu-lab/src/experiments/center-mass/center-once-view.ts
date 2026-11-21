import { createDevice } from '../../gpu/luma'
import { ONCE_POLICY, runOnceStudy, type OnceStudy } from './center-once-study'

export function mountCenterOnce (host: HTMLElement, begin: () => boolean, end: () => void): { pause(): void; destroy(): void } {
  host.innerHTML = `
    <h3>Calculate the center once</h3>
    <p>Compare the current linear force with a version that calculates the center in the final GPU reduction.
      Both keep positions and center on the GPU.</p>
    <label>Points <input data-once-count type="number" min="1" step="1" value="8192"></label>
    <div class="controls">
      <button data-once-run type="button">Compare center calculation</button>
      <button data-once-stop type="button" disabled>Stop</button>
      <button data-once-export type="button" disabled>Export JSON</button>
    </div>
    <p data-once-status aria-live="polite">Not run. Keep this tab visible and pause other GPU work during measurement.</p>
    <p data-once-checks></p>
    <div class="table-scroll"><table>
      <thead><tr><th>GPU work</th><th>Per point (ms)</th><th>Once (ms)</th><th>Once − per point (ms)</th><th>Paired range (ms)</th></tr></thead>
      <tbody data-once-rows></tbody></table></div>
    <p>These are medians of 11 paired GPU samples after warmup, not full graph frame times.
      Exported live results are exploratory unless the exact source is retained.</p>
  `
  const get = <T extends HTMLElement>(selector: string): T => host.querySelector<T>(selector)!
  const input = get<HTMLInputElement>('[data-once-count]')
  const run = get<HTMLButtonElement>('[data-once-run]')
  const stop = get<HTMLButtonElement>('[data-once-stop]')
  const exportButton = get<HTMLButtonElement>('[data-once-export]')
  const status = get<HTMLElement>('[data-once-status]')
  const checks = get<HTMLElement>('[data-once-checks]')
  const table = get<HTMLElement>('[data-once-rows]')
  let cancelled = false; let destroyed = false
  let report: { environment: unknown; result?: OnceStudy; status: string; error?: string } | undefined
  const show = (result: OnceStudy): void => {
    checks.textContent = `Count ${result.countExact ? 'exact' : 'failed'} · aggregate bits ${result.aggregateBitsExact ? 'exact' : 'different'} · ` +
      `force tolerance ${result.forceComparison.valid ? 'passed' : 'failed'} · force values with different bits: ${result.forceBitDifferences.toLocaleString()}`
    for (const timing of result.timings) {
      const row = document.createElement('tr'); const summary = timing.summary
      const value = (n: number | undefined): string => n === undefined ? 'Unavailable' : n.toFixed(4)
      const cells = [timing.stage === 'force' ? 'Force only' : 'Reduction + force',
        value(summary?.perPointMs), value(summary?.onceMs), value(summary?.differenceMs),
        summary ? `${value(summary.differenceRange[0])} to ${value(summary.differenceRange[1])}` : 'Unavailable']
      for (const text of cells) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell) }
      table.append(row)
    }
  }
  run.addEventListener('click', () => {
    // The operation reports errors in the status element.
    // eslint-disable-next-line no-void
    void (async (): Promise<void> => {
      const count = Number(input.value)
      if (!Number.isSafeInteger(count) || count < 1) { status.textContent = 'Enter a positive whole number.'; return }
      if (!begin()) { status.textContent = 'Wait for the current experiment to finish.'; return }
      cancelled = false; run.disabled = true; stop.disabled = false; exportButton.disabled = true
      table.replaceChildren(); checks.textContent = ''; report = { environment: {}, status: 'running' }
      let device: Awaited<ReturnType<typeof createDevice>> | undefined
      try {
        device = await createDevice('webgpu')
        report.environment = {
          browser: navigator.userAgent,
          recordedAt: new Date().toISOString(),
          visibility: document.visibilityState,
          info: device.info,
          luma: '10.0.0-alpha.15',
          timestampQuery: device.features.has('timestamp-query'),
          policy: ONCE_POLICY,
        }
        report.result = await runOnceStudy(device, count, message => { status.textContent = message }, () => cancelled)
        report.status = 'complete'
        if (!destroyed) { show(report.result); status.textContent = 'Finished. Review the checks and GPU timings.' }
      } catch (error) {
        report.status = cancelled ? 'cancelled' : 'error'; report.error = String(error)
        if (!destroyed) status.textContent = `Stopped: ${String(error)}`
      } finally {
        device?.destroy()
        if (!destroyed) { run.disabled = false; stop.disabled = true; exportButton.disabled = false; end() }
      }
    })()
  })
  stop.addEventListener('click', () => { cancelled = true; status.textContent = 'Stopping after the current GPU operation…' })
  exportButton.addEventListener('click', () => {
    if (!report) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'center-once.json'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  })
  return { pause (): void { cancelled = true }, destroy (): void { cancelled = true; destroyed = true } }
}
