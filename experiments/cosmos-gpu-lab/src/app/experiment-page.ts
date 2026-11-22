import type { ExperimentDefinition, ExperimentPage } from '../runtime/experiment'
import { createResultTables } from '../runtime/result-tables'
import { validationContracts } from '../runtime/validation'
import { addArticleSections } from './article-sections'
import { articleSectionId, experimentHref } from './router'
import { researchMethodPages, type ResearchSummary } from './research'
import { renderInvestigationContext } from './research-ui'
import { unlinkOtherExperiments } from './independent-experiment'

type Notes = { ready: Promise<void>; disposed: boolean; dispose(): void }
const notes = new WeakMap<HTMLElement, Notes>()
const contentsSections = [
  ['study-overview', 'Recorded result'],
  ['study-investigations', 'Investigations'],
  ['run-run', 'Experiment'], ['run-results', 'Live results'], ['run-explanation', 'How it works'],
  ['recorded-findings', 'Recorded findings'], ['run-diagnostics', 'Diagnostics'], ['experiment-references', 'References'],
]

export function renderExperimentContents (host: HTMLElement, experiment: ExperimentDefinition): () => void {
  const contents = document.createElement('nav'); contents.className = 'experiment-contents'
  contents.setAttribute('aria-label', 'On this page'); contents.innerHTML = '<p>On this page</p><ul></ul>'
  host.querySelectorAll('.experiment-contents').forEach(node => node.remove())
  const targets: Array<{ link: HTMLAnchorElement; target: HTMLElement }> = []
  const append = (list: HTMLElement, target: HTMLElement, label: string): HTMLLIElement => {
    const item = document.createElement('li'); const link = document.createElement('a'); link.textContent = label
    link.href = `${experimentHref(experiment.id)}?section=${encodeURIComponent(target.id)}`
    item.append(link); list.append(item); targets.push({ link, target }); return item
  }
  const sections = [...contentsSections.flatMap(([id, label]) => {
    const target = host.querySelector<HTMLElement>(`#${id}`)
    return target ? [{ id, label, target }] : []
  }), ...Array.from(host.querySelectorAll<HTMLElement>('.experiment-article'), target => ({
    id: target.id, label: target.dataset.articleTitle ?? 'Evidence', target,
  }))].sort((a, b) => a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
  for (const { label, target } of sections) append(contents.querySelector('ul')!, target, target.dataset.sectionLabel ?? label)
  host.querySelector('.experiment-header')!.after(contents)
  let frame = 0
  const refresh = (): void => {
    frame = 0
    let active = targets[0]
    const threshold = (document.querySelector('.lab-header')?.getBoundingClientRect().bottom ?? 100) + 24
    for (const entry of targets) if (entry.target.getBoundingClientRect().top <= threshold) active = entry
    for (const entry of targets) {
      if (entry === active) entry.link.setAttribute('aria-current', 'location')
      else entry.link.removeAttribute('aria-current')
    }
  }
  const schedule = (): void => { if (!frame) frame = requestAnimationFrame(refresh) }
  const media = window.matchMedia('(max-width: 1050px)')
  const place = (): void => {
    const explanation = media.matches ? host.querySelector('#run-explanation') : null
    if (explanation) explanation.before(contents)
    else host.querySelector('.experiment-header')!.after(contents)
    schedule()
  }
  media.addEventListener('change', place); place()
  const resize = new ResizeObserver(schedule); resize.observe(host)
  window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule)
  refresh()
  return () => {
    resize.disconnect(); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule)
    cancelAnimationFrame(frame); media.removeEventListener('change', place); contents.remove()
  }
}

function moveReferences (wrapper: HTMLElement, page: ExperimentPage, references: HTMLElement): void {
  if (page.id === 'references') {
    wrapper.querySelector('[data-heading-level="1"]')?.remove()
    references.append(wrapper); return
  }
  for (const heading of wrapper.querySelectorAll<HTMLElement>('[data-heading-level="2"]')) {
    const label = heading.childNodes[0]?.textContent?.trim()
    if (!label || !/^(references|sources)$/i.test(label)) continue
    const group = document.createElement('section'); group.className = 'reference-group prose'; group.dataset.documentId = page.id
    const next = heading.nextElementSibling
    let sibling = next
    // Keep all annotations with their sources, and retain the heading's old ID.
    while (sibling && !(sibling.matches('[data-heading-level]') && Number((sibling as HTMLElement).dataset.headingLevel) <= 2)) {
      const following = sibling.nextElementSibling; group.append(sibling); sibling = following
    }
    const title = document.createElement('h3'); title.id = heading.id; title.textContent = page.title === 'Overview' ? 'Concept and pipeline' : page.title
    group.prepend(title); heading.remove(); references.append(group)
  }
}

async function renderArticle (
  parent: HTMLElement, references: HTMLElement, experiment: ExperimentDefinition, record: ResearchSummary, page: ExperimentPage
): Promise<void> {
  const wrapper = document.createElement('section'); wrapper.className = 'experiment-article'
  wrapper.id = articleSectionId(page.id); wrapper.dataset.documentId = page.id
  wrapper.dataset.articleTitle = page.title === 'Overview' ? 'Concept and pipeline' : page.title
  wrapper.dataset.evidenceState = record.investigations.find(item => item.page === page.id)?.state ?? 'Method'
  const target = document.createElement('div'); wrapper.append(target); parent.append(wrapper)
  const item = record.investigations.find(item => item.page === page.id)
  if (item && page.id !== record.evidence && item.state === 'Supporting investigation') {
    const description = document.createElement('p'); description.textContent = item.description; wrapper.prepend(description)
  }
  renderInvestigationContext(target, experiment, record, page.id)
  if (page.id === record.evidence) wrapper.dataset.recordedReport = ''
  try {
    if (page.kind === 'markdown') {
      const { renderMarkdown } = await import('./markdown')
      renderMarkdown(target, await page.load(), page.assets, {
        examples: page.examples,
        sectionNavigation: false,
        headingLevelOffset: 2,
        tables: false,
      })
      addArticleSections(wrapper, experiment.id, page.id)
      if (page.title === 'Overview') {
        const title = target.querySelector('[data-heading-level="1"]')
        if (title) title.childNodes[0].textContent = 'Concept and pipeline'
      }
    } else {
      const { renderReport } = await import('./report')
      renderReport(target, await page.load(), experiment.id, { embedded: true })
    }
    moveReferences(wrapper, page, references)
  } catch {
    target.innerHTML = '<p>Could not load this article. Reload the page to try again.</p>'
  }
}

async function renderNotes (host: HTMLElement, experiment: ExperimentDefinition, record: ResearchSummary): Promise<void> {
  const contract = validationContracts[experiment.id]
  const parked = record.investigations.some(item => item.page === record.evidence && item.state === 'Parked')
  const content = document.createElement('div'); content.className = 'experiment-notes'
  const contractId = articleSectionId('validation-contract')
  const fields = [['question', 'Comparison question', contract.question], ['reference', 'Reference', contract.reference],
    ['acceptance', 'Acceptance', contract.acceptance], ['checked-population', 'Checked population', contract.coverage], ['limits', 'Limits', contract.limits]]
  content.innerHTML = `<section class="experiment-method" id="run-explanation" aria-labelledby="experiment-method-title">
    <h2 id="experiment-method-title">How it works</h2><p class="section-summary">${record.comparison}</p>
    <div data-experiment-guidance></div><h3>${parked ? 'Research record' : 'Try it'}</h3><p>${record.reproduce}</p>
    <section id="${contractId}"><h3>What we compare</h3><dl class="experiment-contract">${fields.map(([id, title, value]) =>
  `<div id="${articleSectionId('validation-contract', id)}"><dt>${title}</dt><dd>${value}</dd></div>`).join('')}</dl></section>
    ${record.methods?.length
    ? `<section id="methods-and-alternatives"><h3>Methods and alternatives</h3><ul class="method-assessments">
      ${record.methods.map(method => `<li><a href="${experimentHref(experiment.id, method.page, method.section)}">${method.title}</a>
      <span class="research-meta"> · ${method.verdict}</span><p>${method.detail}</p></li>`).join('')}</ul></section>`
    : ''}
    <div data-method-articles></div></section>
    <section class="recorded-findings" id="recorded-findings" aria-labelledby="recorded-findings-title">
      <h2 id="recorded-findings-title">Recorded findings</h2><div data-findings-articles></div>
      <h3>Scope</h3><p>${record.scope}</p>
      <p class="research-meta">Assessed variant: ${record.variant}. Reviewed ${record.reviewed}.</p>
      <section class="earlier-findings"><h3>Earlier investigations</h3><div data-earlier-articles></div></section>
    </section>
    <section class="experiment-references" id="experiment-references"><h2>References</h2>
      <p>Use the <a href="#/validation-workflow">validation workflow</a> to classify a difference and the
      <a href="#/numerical-research">numerical research report</a> for the specification basis.
      Record backend, browser, device, inputs, checked population and raw failures with every finding.</p>
      <div data-article-references></div></section>`
  const frame = host.querySelector('.run-layout')!
  const originalGuidance = frame.querySelector('#run-explanation')
  if (originalGuidance) {
    originalGuidance.querySelector('h2')?.remove()
    content.querySelector('[data-experiment-guidance]')!.append(...originalGuidance.childNodes); originalGuidance.remove()
  }
  const references = content.querySelector<HTMLElement>('[data-article-references]')!
  const diagnostics = frame.querySelector('#run-diagnostics')
  if (diagnostics) {
    diagnostics.before(content)
    diagnostics.after(content.querySelector('.experiment-references')!)
  } else frame.append(content)
  const jobs: Promise<void>[] = []
  for (const id of researchMethodPages(record)) {
    if (id === 'validation-contract' || id === 'agent-recipe' || id === record.evidence) continue
    const page = experiment.pages.find(page => page.id === id)!
    jobs.push(renderArticle(content.querySelector('[data-method-articles]')!, references, experiment, record, page))
  }
  const primary = experiment.pages.find(page => page.id === record.evidence)
  if (primary) jobs.push(renderArticle(content.querySelector('[data-findings-articles]')!, references, experiment, record, primary))
  else {
    content.querySelector('[data-findings-articles]')!.innerHTML =
      '<p data-recorded-report>No recorded measurement matrix is published for this experiment yet. ' +
      'Live results above describe this browser session; they do not approve the overall migration.</p>'
  }
  const earlier = record.investigations.filter(item => item.page !== record.evidence)
  for (const item of earlier) {
    const page = experiment.pages.find(page => page.id === item.page)!
    jobs.push(renderArticle(content.querySelector('[data-earlier-articles]')!, references, experiment, record, page))
  }
  if (!earlier.length) content.querySelector('.earlier-findings')!.remove()
  await Promise.all(jobs)
  // Source requests are concurrent, while reference groups retain article order.
  const order = experiment.pages.map(page => page.id)
  references.replaceChildren(...Array.from(references.children).sort((a, b) => {
    const pageOf = (element: Element): number => order.indexOf((element as HTMLElement).dataset.documentId!)
    return pageOf(a) - pageOf(b)
  }))
  unlinkOtherExperiments(host, experiment)
}

export function mountExperimentNotes (host: HTMLElement, experiment: ExperimentDefinition, record: ResearchSummary): Promise<void> {
  const existing = notes.get(host)
  if (existing) return existing.ready
  const state: Notes = { ready: undefined!, disposed: false, dispose: () => {} }
  notes.set(host, state)
  state.ready = renderNotes(host, experiment, record).then(() => {
    if (state.disposed) return
    const tables = createResultTables(host.querySelector('.run-layout')!, { only: '.experiment-notes, .experiment-references' })
    tables.refresh(); state.dispose = tables.destroy
  })
  return state.ready
}

export function disposeExperimentNotes (host: HTMLElement): void {
  const state = notes.get(host)
  if (state) { state.disposed = true; state.dispose(); notes.delete(host) }
}
