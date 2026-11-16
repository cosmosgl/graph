import type { ExperimentInstance } from '../../runtime/experiment'
import { mountRunLayout, disposeRunLayout } from '../../runtime/run-layout'

// Retain the result as a research record without initializing a GPU or offering more runs.
export async function createRibbonView (host: HTMLElement): Promise<ExperimentInstance> {
  host.innerHTML = `<p data-run-part="status" role="status">Investigation stopped. No benchmark is running.</p>
    <section data-run-part="results">
      <p>The simple compute sample cache was not adopted. Rebuilding generally cost more than vertex generation;
        static reuse did not show a consistent benefit.</p>
      <p>The recorded native screen and its limitations remain below. The larger three-segment workload changed two color pixels;
        the cache also required 30.52 MiB at 100,000 links and 19 segments.</p>
    </section>`
  mountRunLayout(host, () => ({
    state: 'Stopped',
    passed: 'No live checks; see recorded findings',
    failed: 'Recorded coarse-curve color mismatch; no live assessment',
    unchecked: 'Further optimization and production integration are not being pursued',
  }), { experiment: 'ribbon-generation', devices: () => ['No GPU initialized'] })
  host.querySelector('.run-settings')?.remove()
  host.querySelector('.run-overview')?.remove()
  host.querySelector('.result-context')?.remove()
  const results = host.querySelector<HTMLElement>('#run-results')
  if (results) { results.dataset.sectionLabel = 'Investigation outcome'; results.setAttribute('aria-label', 'Investigation outcome') }
  const heading = host.querySelector('#run-results > h2')
  if (heading) heading.textContent = 'Investigation outcome'
  host.querySelector('#run-run')?.setAttribute('aria-label', 'Investigation status')
  return { destroy: (): void => disposeRunLayout(host) }
}
