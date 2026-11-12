import type { ExperimentDefinition } from '../runtime/experiment'
import { validationContracts } from '../runtime/validation'
import { experimentHref } from './router'
import { researchMethodPages, type ResearchSummary } from './research'

const notes = new WeakMap<HTMLElement, Promise<void>>()

export function renderExperimentContents (host: HTMLElement, experiment: ExperimentDefinition): void {
  const contents = document.createElement('nav'); contents.className = 'experiment-contents'
  contents.setAttribute('aria-label', 'Experiment contents')
  const sections = [['run-configuration', 'Settings'], ['run-results', 'Live results'],
    ['run-explanation', 'How it works'], ['recorded-findings', 'Recorded findings']]
  if (host.querySelector('#run-diagnostics')) sections.push(['run-diagnostics', 'Diagnostics'])
  for (const [id, label] of sections) {
    const link = document.createElement('a'); link.textContent = label
    link.href = `${experimentHref(experiment.id)}?section=${id}`
    link.addEventListener('click', event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = host.querySelector<HTMLElement>(`#${id}`)
      if (!target) return
      event.preventDefault(); window.history.replaceState(null, '', link.href)
      target.scrollIntoView({ block: 'start' }); target.tabIndex = -1; target.focus({ preventScroll: true })
    })
    contents.append(link)
  }
  const previous = host.querySelector(':scope > .experiment-contents')
  if (previous) previous.replaceWith(contents)
  else host.prepend(contents)
}

async function renderNotes (host: HTMLElement, experiment: ExperimentDefinition, record: ResearchSummary): Promise<void> {
  const contract = validationContracts[experiment.id]
  const content = document.createElement('div'); content.className = 'experiment-notes'
  const methods = researchMethodPages(record).map(id => experiment.pages.find(page => page.id === id)!)
  content.innerHTML = `<section class="experiment-method" id="run-explanation" aria-labelledby="experiment-method-title">
    <h2 id="experiment-method-title">How it works</h2>
    <p>${experiment.summary}</p><p>${record.comparison}</p>
    <div data-experiment-guidance></div>
    <h3>Reproduce</h3><p>${record.reproduce}</p>
    <dl class="experiment-contract">
      <div><dt>Reference</dt><dd>${contract.reference}</dd></div>
      <div><dt>Acceptance</dt><dd>${contract.acceptance}</dd></div>
      <div><dt>Checked population</dt><dd>${contract.coverage}</dd></div>
      <div><dt>Limits</dt><dd>${contract.limits}</dd></div>
    </dl>
    <h3>Technical articles</h3><ul class="experiment-articles">${methods.map(page => `<li>
      <a href="${experimentHref(experiment.id, page.id)}">${page.title === 'Overview' ? 'Concept and pipeline' : page.title}</a></li>`).join('')}</ul>
    </section>
    <section class="recorded-findings" id="recorded-findings" aria-labelledby="recorded-findings-title">
      <h2 id="recorded-findings-title">Recorded findings</h2>
      <div data-recorded-report></div>
      <h3>Scope and next steps</h3><p>${record.scope}</p><p>${record.next}</p>
      <p class="research-meta">Assessed variant: ${record.variant}. Reviewed ${record.reviewed}.</p>
      <p><a href="#/roadmap?section=milestone-${record.milestone}">Related migration milestone</a></p>
    </section>`
  const frame = host.querySelector('.run-layout')!
  const originalGuidance = frame.querySelector('#run-explanation')
  if (originalGuidance) {
    originalGuidance.querySelector('h2')?.remove()
    content.querySelector('[data-experiment-guidance]')!.append(...originalGuidance.childNodes)
    originalGuidance.remove()
  }
  const diagnostics = frame.querySelector('#run-diagnostics')
  if (diagnostics) diagnostics.before(content)
  else frame.append(content)
  const previous = record.investigations.filter(item => item.page !== record.evidence)
  if (previous.length) {
    const history = document.createElement('section'); history.className = 'earlier-findings'
    history.innerHTML = `<h3>Earlier investigations</h3><ul>${previous.map(item => {
      const page = experiment.pages.find(page => page.id === item.page)!
      return `<li><a href="${experimentHref(experiment.id, item.page)}">${page.title}</a><p>${item.description}</p></li>`
    }).join('')}</ul>`
    content.querySelector('.recorded-findings')!.append(history)
  }
  const report = content.querySelector<HTMLElement>('[data-recorded-report]')!
  const page = experiment.pages.find(page => page.id === record.evidence)
  if (!page) {
    report.innerHTML = '<p>No recorded measurement matrix is published for this experiment yet. ' +
      'Live results above describe this browser session; they do not approve the overall migration.</p>'
    return
  }
  try {
    if (page.kind === 'markdown') {
      const { renderMarkdown } = await import('./markdown')
      await renderMarkdown(report, await page.load(), page.assets, { sectionNavigation: false, headingLevelOffset: 2, tables: false })
    } else {
      const { renderReport } = await import('./report')
      renderReport(report, await page.load(), experiment.id, { embedded: true })
    }
  } catch {
    report.innerHTML = `<p>Could not load the recorded article. <a href="${experimentHref(experiment.id, page.id)}">Open ${page.title}</a>.</p>`
  }
}

// Notes belong to the retained experiment DOM too. Opening an article and
// returning must not reset either the live controls or the recorded article.
export function mountExperimentNotes (host: HTMLElement, experiment: ExperimentDefinition, record: ResearchSummary): Promise<void> {
  const existing = notes.get(host)
  if (existing) return existing
  const pending = renderNotes(host, experiment, record)
  notes.set(host, pending)
  return pending
}
