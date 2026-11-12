import { validationContracts } from './validation'
import { addRunGuidance } from './run-guidance'
import { createResultTables } from './result-tables'

export type RunSummary = {
  state: string;
  passed: string;
  failed: string;
  unchecked: string;
}

type Dispose = () => void
const presentations = new WeakMap<HTMLElement, Dispose>()
type RunContext = { experiment: string; devices?: () => string[] }

// Regions and action roles are authored by each view. Never classify prose by
// its DOM position, or infer numerical acceptance from a status message.
export function mountRunLayout (host: HTMLElement, read: () => RunSummary, context?: RunContext): void {
  presentations.get(host)?.()
  const opened = new Date().toISOString()
  const frame = document.createElement('div'); frame.className = 'run-layout integrated-run'
  frame.innerHTML = `<section class="run-overview" aria-label="Current local run"
      data-run-summary>
    <p class="run-source">Live results · session started ${opened.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}</p>
    <dl>${['state', 'passed', 'failed', 'unchecked'].map((key, i) =>
    `<div><dt>${['Run state', 'Passed', 'Failed / unavailable', 'Unchecked'][i]}</dt><dd
      data-run-summary-value="${key}"></dd></div>`).join('')}</dl>
    <div
      data-run-slot="status"></div></section>
    <div class="run-workbench"><section class="run-settings" id="run-configuration" aria-label="Configuration"><h2>Configuration</h2></section>
      <div class="run-display"><section id="run-run" aria-label="Live comparison"><div class="controls run-primary-actions"></div>
        <div class="run-visualization"></div></section><section id="run-results" aria-label="Live results"><h2>Live results</h2>
        <div class="result-context"
      data-run-owned><dl><div><dt>Device</dt><dd
      data-run-devices>Not reported</dd></div>
          <div><dt>Scope</dt><dd
      data-run-scope></dd></div></dl>
          <p>Pass / Fail refer to the named check. Unchecked means no check ran; Unavailable means a result could not be obtained.</p></div>
        <div class="controls run-export-actions"></div></section></div></div>
    <section class="run-explanation" id="run-explanation"><h2>Explanation</h2></section>
    <section class="run-diagnostics" id="run-diagnostics" aria-label="Diagnostics"><h2>Diagnostics</h2>
      <div class="controls run-diagnostic-actions"></div></section>`
  const slot = (selector: string): HTMLElement => frame.querySelector<HTMLElement>(selector)!
  const destinations: Record<string, HTMLElement> = {
    configuration: slot('.run-settings'),
    visualization: slot('.run-visualization'),
    metrics: slot('.run-visualization'),
    results: slot('#run-results'),
    diagnostics: slot('#run-diagnostics'),
    explanation: slot('#run-explanation'),
    status: slot('[data-run-slot="status"]'),
  }
  const regions = Array.from(host.querySelectorAll<HTMLElement>('[data-run-part], [data-run-section]'))
  for (const region of regions) {
    const name = region.dataset.runPart ?? (region.dataset.runSection === 'run' ? 'visualization' : region.dataset.runSection)!
    const destination = destinations[name]
    if (!destination) throw new Error(`Unknown run region: ${name}`)
    if (name === 'status') region.setAttribute('aria-live', 'polite')
    destination.append(region)
  }
  for (const button of frame.querySelectorAll<HTMLElement>('[data-run-action]')) {
    const role = button.dataset.runAction!
    const destination = slot(role === 'primary' ? '.run-primary-actions' : role === 'export' ? '.run-export-actions' : '.run-diagnostic-actions')
    // Keep diagnostic tools beside their own diagnostic settings when authored together.
    if (role === 'diagnostic' && button.closest('[data-run-part="diagnostics"], [data-run-section="diagnostics"]')) continue
    destination.append(button)
  }
  // An action may live outside an explicitly grouped region.
  for (const button of Array.from(host.querySelectorAll<HTMLElement>('[data-run-action]'))) {
    const role = button.dataset.runAction!
    slot(role === 'primary' ? '.run-primary-actions' : role === 'export' ? '.run-export-actions' : '.run-diagnostic-actions').append(button)
  }
  for (const empty of frame.querySelectorAll('.controls')) if (!empty.children.length) empty.remove()
  const diagnostics = slot('#run-diagnostics')
  if (diagnostics.children.length === 1) diagnostics.remove()
  const explanation = slot('#run-explanation')
  if (explanation.children.length === 1) explanation.remove()
  const selectedValues = Array.from(frame.querySelectorAll<HTMLSelectElement>('.run-settings select')).map(select => {
    const hint = document.createElement('span'); hint.className = 'run-selected-value'; hint.setAttribute('aria-hidden', 'true')
    select.after(hint)
    return { select, hint }
  })
  slot('#run-results > h2').after(slot('.run-overview'))
  slot('.run-visualization').before(slot('[data-run-slot="status"]'))
  const tick = frame.querySelector('.tick-counter')
  if (tick) {
    const toolbar = tick.parentElement!
    slot('.run-primary-actions').append(tick)
    if (!toolbar.children.length) toolbar.remove()
  }
  const workbench = slot('.run-workbench'); const display = slot('.run-display')
  const settings = slot('.run-settings'); const visualization = slot('#run-run'); const results = slot('#run-results')
  const wide = window.matchMedia('(min-width: 1200px)')
  // Move the original nodes so visual, keyboard and reading order agree at
  // both sizes. Settings never push the narrow-screen canvas out of reach.
  const reflow = (): void => {
    if (wide.matches) {
      display.append(visualization, results); workbench.replaceChildren(display, settings)
    } else workbench.replaceChildren(visualization, settings, results)
  }
  reflow(); wide.addEventListener('change', reflow)
  host.prepend(frame)
  if (context) addRunGuidance(frame, context.experiment)
  slot('[data-run-scope]').textContent = context
    ? `${validationContracts[context.experiment]?.coverage ?? 'Only the inputs and checks explicitly named below.'} ` +
      'Sweeps use their own row parameters. This session does not approve the overall migration.'
    : 'Only the inputs and checks explicitly named below; no overall migration approval.'
  const tables = createResultTables(frame, { exclude: '.experiment-notes, .experiment-references' })
  const refresh = (): void => {
    const values = read()
    for (const key of ['state', 'passed', 'failed', 'unchecked'] as const) {
      const output = slot(`[data-run-summary-value="${key}"]`)
      if (output.textContent !== values[key]) output.textContent = values[key]
    }
    for (const { select, hint } of selectedValues) {
      const label = select.selectedOptions[0]?.textContent?.trim() ?? ''
      const hidden = label.length < 30
      if (hint.hidden !== hidden) hint.hidden = hidden
      if (hint.textContent !== label) hint.textContent = label
    }
    const devices = [...new Set(context?.devices?.().filter(Boolean) ?? [])].join(' · ') || 'Not reported by this experiment yet'
    if (slot('[data-run-devices]').textContent !== devices) slot('[data-run-devices]').textContent = devices
    tables.refresh()
  }
  // Read typed experiment state after batched UI updates. The observer is only a
  // refresh trigger; it never parses labels, tables or colors into verdicts.
  const observer = new MutationObserver(records => {
    const sourceChanged = records.some(record => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement
      return !element?.closest('[data-run-summary-value], [data-run-owned]')
    })
    if (sourceChanged) refresh()
  })
  observer.observe(host, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden'] })
  host.addEventListener('change', refresh)
  presentations.set(host, () => {
    observer.disconnect(); tables.destroy(); wide.removeEventListener('change', reflow); host.removeEventListener('change', refresh)
  })
  refresh()
}

export function disposeRunLayout (host: HTMLElement): void {
  presentations.get(host)?.(); presentations.delete(host)
}

export function checkSummary (checks: Array<{ valid: boolean }>, label = 'checks'): Pick<RunSummary, 'passed' | 'failed'> {
  return {
    passed: checks.length ? `${checks.filter(check => check.valid).length} / ${checks.length} ${label}` : 'No checks yet',
    failed: checks.some(check => !check.valid) ? `${checks.filter(check => !check.valid).length} failed ${label}` : 'None recorded',
  }
}

export function summarizeRun (
  state: string, verdicts: ReadonlyArray<boolean | undefined>, unchecked: string,
  unavailable: string[] = [], error?: string, label = 'checks'
): RunSummary {
  const checked = verdicts.filter((value): value is boolean => typeof value === 'boolean')
  const counts = checkSummary(checked.map(valid => ({ valid })), label)
  const failures = [counts.failed === 'None recorded' ? '' : counts.failed,
    unavailable.length ? `Unavailable: ${unavailable.join(', ')}` : '', error ? 'Operation error · see status' : ''].filter(Boolean)
  return { state: error ? 'Failed' : state, passed: counts.passed, failed: failures.join(' · ') || 'None recorded', unchecked }
}

export function recordVerdicts (rows: readonly unknown[], key = 'valid'): Array<boolean | undefined> {
  return rows.map(row => {
    const value = row && typeof row === 'object' ? (row as Record<string, unknown>)[key] : undefined
    return typeof value === 'boolean' ? value : undefined
  })
}
