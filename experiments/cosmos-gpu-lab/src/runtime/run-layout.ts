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
type RunContext = {
  experiment: string; devices?: () => string[]; scope?: string; showChecks?: boolean; resultsFirst?: boolean;
  secondarySettings?: readonly string[];
}

function placeSecondarySettings (frame: HTMLElement, selectors: readonly string[]): void {
  const configuration = frame.querySelector('#run-configuration')!
  const fields = new Set<Element>()
  for (const selector of selectors) {
    for (const element of configuration.querySelectorAll(selector)) fields.add(element.closest('label') ?? element)
  }
  if (!fields.size) return
  const section = document.createElement('section'); section.className = 'run-secondary-settings'; section.id = 'run-more-settings'
  section.innerHTML = '<h2>More settings</h2><div class="scale-toolbar"></div>'
  section.lastElementChild!.append(...fields)
  frame.querySelector('#run-run')!.after(section)
}

// Regions and action roles are authored by each view. Never classify prose by
// its DOM position, or infer numerical acceptance from a status message.
export function mountRunLayout (host: HTMLElement, read?: () => RunSummary, context?: RunContext): void {
  presentations.get(host)?.()
  const showChecks = context?.showChecks !== false
  const keys: Array<keyof RunSummary> = showChecks ? ['state', 'passed', 'failed', 'unchecked'] : ['state']
  const frame = document.createElement('div'); frame.className = 'run-layout integrated-run'
  frame.innerHTML = `<div class="run-workbench">
      <section class="run-settings" id="run-configuration" aria-label="Configuration"></section>
      <section id="run-run" aria-label="Live comparison"><div class="controls run-primary-actions"></div>
        <div class="run-visualization"></div><div data-run-slot="status"></div></section>
      ${read
    ? `<section id="run-results" aria-label="Live results"><h2>Live results</h2>
        <section class="run-overview" aria-label="Current local run" data-run-summary>
          ${showChecks ? `<p class="run-source">Session started ${new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}</p>` : ''}
          <dl>${keys.map((key, i) =>
    `<div><dt>${['Run state', 'Passed', 'Failed / unavailable', 'Unchecked'][i]}</dt><dd
            data-run-summary-value="${key}"></dd></div>`).join('')}</dl>
        </section>
        <div class="result-context" data-run-owned><dl><div><dt>Device</dt><dd data-run-devices>Not reported</dd></div>
          <div><dt>Scope</dt><dd
      data-run-scope></dd></div></dl>
          ${showChecks ? '<p>Pass / Fail refer to the named check. Unchecked means no check ran; Unavailable means a result could not be obtained.</p>' : ''}
        </div>
        <div class="controls run-export-actions"></div></section>`
    : ''}</div>
    <section class="run-explanation" id="run-explanation"><h2>Explanation</h2></section>
    <section class="run-diagnostics" id="run-diagnostics" aria-label="Diagnostics"><h2>Diagnostics</h2>
      <div class="controls run-diagnostic-actions"></div></section>`
  const slot = (selector: string): HTMLElement => frame.querySelector<HTMLElement>(selector)!
  const results = frame.querySelector<HTMLElement>('#run-results')
  const destinations: Record<string, HTMLElement | null> = {
    configuration: slot('.run-settings'),
    visualization: slot('.run-visualization'),
    metrics: slot('.run-visualization'),
    results,
    diagnostics: slot('#run-diagnostics'),
    explanation: slot('#run-explanation'),
    status: slot('[data-run-slot="status"]'),
  }
  const regions = host.querySelectorAll<HTMLElement>('[data-run-part], [data-run-section]')
  const actions = host.querySelectorAll<HTMLElement>('[data-run-action]')
  for (const region of regions) {
    const name = region.dataset.runPart ?? (region.dataset.runSection === 'run' ? 'visualization' : region.dataset.runSection)!
    const destination = destinations[name]
    if (!destination) throw new Error(`Unknown run region: ${name}`)
    if (name === 'status') region.setAttribute('aria-live', 'polite')
    destination.append(region)
  }
  for (const button of actions) {
    const role = button.dataset.runAction!
    const destination = slot(role === 'primary' ? '.run-primary-actions' : role === 'export' ? '.run-export-actions' : '.run-diagnostic-actions')
    // Keep diagnostic tools beside their own diagnostic settings when authored together.
    if (role === 'diagnostic' && button.closest('[data-run-part="diagnostics"], [data-run-section="diagnostics"]')) continue
    destination.append(button)
  }
  const tick = frame.querySelector('.tick-counter')
  if (tick) {
    const toolbar = tick.parentElement!
    slot('.run-primary-actions').append(tick)
    if (!toolbar.children.length) toolbar.remove()
  }
  for (const empty of frame.querySelectorAll('.controls')) if (!empty.children.length) empty.remove()
  const diagnostics = slot('#run-diagnostics')
  if (diagnostics.children.length === 1) diagnostics.remove()
  const explanation = slot('#run-explanation')
  if (explanation.children.length === 1) explanation.remove()
  if (context?.secondarySettings) placeSecondarySettings(frame, context.secondarySettings)
  for (const toolbar of frame.querySelectorAll('.run-settings > .scale-toolbar')) {
    if (!toolbar.childElementCount && !toolbar.textContent?.trim()) toolbar.remove()
  }
  const selectedValues = Array.from(frame.querySelectorAll<HTMLSelectElement>('.run-settings select, .run-secondary-settings select')).map(select => {
    const hint = document.createElement('span'); hint.className = 'run-selected-value'; hint.setAttribute('aria-hidden', 'true')
    select.after(hint)
    return { select, hint }
  })
  if (results && context?.resultsFirst) {
    const sections = Array.from(results.children).filter(element =>
      element instanceof HTMLElement && (element.dataset.runPart === 'results' || element.dataset.runSection === 'results'))
    results.querySelector('h2')!.after(...sections)
  }
  if (host.hasAttribute('data-study-run')) slot('#run-run').id = 'run-live-viewer'
  if (host.hasAttribute('data-page-explanation')) explanation.id = 'run-live-explanation'
  host.prepend(frame)
  if (context) addRunGuidance(frame, context.experiment)
  if (results) {
    slot('[data-run-scope]').textContent = context?.scope ?? (context
      ? validationContracts[context.experiment]?.coverage ?? 'Only the inputs and checks explicitly named below.'
      : 'Only the inputs and checks explicitly named below.')
  }
  const tables = createResultTables(frame)
  const refresh = (): void => {
    for (const { select, hint } of selectedValues) {
      const label = select.selectedOptions[0]?.textContent?.trim() ?? ''
      const hidden = label.length < 30
      if (hint.hidden !== hidden) hint.hidden = hidden
      if (hint.textContent !== label) hint.textContent = label
    }
    if (read) {
      const values = read()
      for (const key of keys) {
        const output = slot(`[data-run-summary-value="${key}"]`)
        if (output.textContent !== values[key]) output.textContent = values[key]
      }
      const devices = [...new Set(context?.devices?.().filter(Boolean) ?? [])].join(' · ')
      const deviceOutput = slot('[data-run-devices]')
      const deviceRow = deviceOutput.parentElement!
      const hideDevice = !showChecks && !devices
      if (deviceRow.hidden !== hideDevice) deviceRow.hidden = hideDevice
      const deviceText = devices || 'Not reported by this experiment yet'
      if (deviceOutput.textContent !== deviceText) deviceOutput.textContent = deviceText
    }
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
    observer.disconnect(); tables.destroy(); host.removeEventListener('change', refresh)
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
