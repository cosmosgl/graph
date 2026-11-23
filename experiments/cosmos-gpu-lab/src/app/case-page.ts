import type { ExperimentCase, ExperimentDefinition, ExperimentPage } from '../runtime/experiment'
import { renderResultChart } from '../runtime/result-chart'
import { disposeDocumentTables, presentDocumentTables } from '../runtime/result-tables'
import { addArticleSections } from './article-sections'
import { renderMarkdown } from './markdown'
import { experimentMiniCard } from './experiment-mini-card'
import { caseEvidencePages, evidencePageAt, findingSection, isReaderPage, startingCase } from './experiment-route'
import { unlinkOtherExperiments } from './independent-experiment'
import { experimentGroups } from './registry'
import { readinessFor } from './readiness'
import { readinessBadge, recordedObservations } from './readiness/presentation'
import { articleSectionId, experimentHref } from './router'

type CaseFrame = {
  stage: HTMLElement;
  slot: HTMLElement;
  recorded: HTMLElement;
  status: HTMLElement;
  retry: HTMLButtonElement;
  openEvidence: (section: string) => Promise<string | undefined>;
  setLiveCase: (active: ExperimentCase) => void;
  onChooseCase: (choose: (item: ExperimentCase, control: HTMLElement) => void) => void;
}

function paragraph (text: string, className?: string): HTMLParagraphElement {
  const element = document.createElement('p')
  element.textContent = text
  if (className) element.className = className
  return element
}

function topicFor (experiment: ExperimentDefinition): (typeof experimentGroups)[number] | undefined {
  return experimentGroups.find(group => group.experiments.some(candidate => candidate.id === experiment.id))
}

function addTopicLink (header: HTMLElement, topic: ReturnType<typeof topicFor>): void {
  if (!topic) return
  const link = document.createElement('a'); link.className = 'case-topic-link'; link.href = `#/?section=catalog-${topic.id}`
  const arrow = document.createElement('span'); arrow.textContent = '← '; arrow.setAttribute('aria-hidden', 'true')
  link.append(arrow, document.createTextNode(topic.title)); header.prepend(link)
}

function groupNavigation (experiment: ExperimentDefinition, topic: ReturnType<typeof topicFor>): HTMLElement | undefined {
  const peers = topic?.experiments.filter(candidate => candidate.id !== experiment.id) ?? []
  if (!topic || !peers.length) return undefined
  const label = `More in ${topic.title}`
  const nav = document.createElement('nav'); nav.className = 'case-navigation case-group-navigation'; nav.setAttribute('aria-label', label)
  const list = document.createElement('ul')
  for (const peer of peers) {
    const entry = document.createElement('li')
    entry.append(experimentMiniCard(peer.title, experimentHref(peer.id), readinessFor(peer.id, startingCase(peer))))
    list.append(entry)
  }
  const heading = document.createElement('h2'); heading.textContent = label
  nav.append(heading, list)
  return nav
}

function findingRow (title: string, date: string, id: string): { row: HTMLLIElement; name: HTMLDivElement } {
  const row = document.createElement('li'); row.id = id
  const name = document.createElement('div')
  const heading = document.createElement('h3'); heading.textContent = title
  name.append(heading)
  if (date) name.append(paragraph(date, 'case-meta'))
  row.append(name)
  return { row, name }
}

function recordedFindings (experiment: ExperimentDefinition): HTMLElement {
  const section = document.createElement('section'); section.className = 'case-recorded'; section.id = 'recorded-findings'
  const heading = document.createElement('h2'); heading.textContent = 'Recorded findings'; section.append(heading)
  const list = document.createElement('ul'); list.className = 'case-observations'; list.setAttribute('aria-label', 'Evidence and limits')
  if (experiment.singlePage) {
    section.append(paragraph(startingCase(experiment).recorded!.conclusion))
    for (const observation of experiment.singlePage.observations) {
      const { row } = findingRow(observation.title, observation.date, observation.id)
      row.append(paragraph(observation.evidence), paragraph(observation.limits, 'case-observation-limits'),
        ...(observation.charts?.map(renderResultChart) ?? []))
      list.append(row)
    }
  } else {
    for (const item of experiment.cases!) {
      const { row, name } = findingRow(item.title, item.recorded?.date ?? '', findingSection(item))
      const result = document.createElement('div')
      result.append(paragraph(item.recorded?.conclusion ?? 'No recorded finding is available yet.'),
        recordedObservations(readinessFor(experiment.id, item).evidence))
      const limits = document.createElement('div'); limits.className = 'case-observation-limits'
      if (item.recorded) {
        name.append(paragraph(item.recorded.environment, 'case-meta'))
        limits.append(paragraph(item.recorded.scope), paragraph(item.recorded.limits))
      } else limits.append(paragraph(item.acceptance))
      row.append(result, limits, ...(item.recorded?.charts?.map(renderResultChart) ?? [])); list.append(row)
    }
  }
  section.append(list)
  return section
}

// Agent replay instructions stay in the source files. The human-readable
// evidence retains observations, failed controls, provenance and references.
function removeInstructionSentences (element: HTMLElement): void {
  const text = element.textContent ?? ''
  const agentLinks = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href*="agent-recipe"]'), link => {
    const preceding = document.createRange(); preceding.selectNodeContents(element); preceding.setEndBefore(link)
    return preceding.toString().length
  })
  const instruction = /(?:\b(?:agent(?:-only|s)?\s+(?:recipe|instructions|workflow)|another agent|LAB_[A-Z0-9_]+|pnpm|npm|npx|vitest|SHA-256)\b|\bcaptures\/)/i
  const boundaries = [0]
  for (const match of text.matchAll(/[.!?](?:\s+|$)/g)) boundaries.push(match.index! + match[0].length)
  if (boundaries.at(-1) !== text.length) boundaries.push(text.length)
  const remove: Array<[number, number]> = []
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]; const end = boundaries[index + 1]
    if (instruction.test(text.slice(start, end)) || agentLinks.some(position => position >= start && position < end)) remove.push([start, end])
  }
  for (const [start, end] of remove.reverse()) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []; let node: Node | null
    while ((node = walker.nextNode())) nodes.push(node as Text)
    let offset = 0
    for (const textNode of nodes) {
      const next = offset + textNode.length
      const from = Math.max(0, start - offset); const to = Math.min(textNode.length, end - offset)
      if (from < to) textNode.deleteData(from, to - from)
      offset = next
    }
  }
  for (const link of element.querySelectorAll('a')) if (!link.textContent?.trim()) link.remove()
  if (!element.textContent?.trim()) element.remove()
}

function removeReproductionInstructions (host: HTMLElement): void {
  for (const heading of Array.from(host.querySelectorAll<HTMLElement>('[data-heading-level]'))) {
    const label = heading.dataset.sectionLabel ?? heading.textContent ?? ''
    const reproduction = /^(?:(?:run and |try and |how to )?reproduc(?:e|tion)\b|instructions for agents\b|agent recipe\b)/i.test(label.trim())
    const workflow = /^(?:run it\b|replay instructions\b|evidence and workflow review\b)/i.test(label.trim())
    if (!reproduction && !workflow) continue
    const level = Number(heading.dataset.headingLevel)
    let node: Element | null = heading.nextElementSibling
    while (node && !(node instanceof HTMLElement && node.dataset.headingLevel && Number(node.dataset.headingLevel) <= level)) {
      const next: Element | null = node.nextElementSibling; node.remove(); node = next
    }
    heading.remove()
  }
  for (const element of Array.from(host.querySelectorAll<HTMLElement>('p, li'))) {
    if (host.contains(element) && !(element.tagName === 'LI' && element.querySelector('p'))) removeInstructionSentences(element)
  }
  for (const code of host.querySelectorAll('pre code.language-sh, pre code.language-bash, pre code.language-shell')) code.parentElement?.remove()
  for (const pre of host.querySelectorAll('pre')) {
    if (/\b(?:LAB_[A-Z0-9_]+|pnpm|npx|vitest)\b/i.test(pre.textContent ?? '')) pre.remove()
  }
  for (const table of host.querySelectorAll<HTMLTableElement>('table')) {
    const columns = Array.from(table.tHead?.rows[0]?.cells ?? []).flatMap((cell, index) =>
      /\bcaptures\/|\blocal capture\b|SHA-256|source archive/i.test(cell.textContent ?? '') ? [index] : []).reverse()
    if (!columns.length) continue
    for (const row of Array.from(table.rows)) for (const index of columns) if (row.cells[index]) row.deleteCell(index)
    if ((table.tHead?.rows[0]?.cells.length ?? 0) < 2) {
      const region = table.closest('.table-scroll') ?? table
      if (region.previousElementSibling?.classList.contains('table-scroll-hint')) region.previousElementSibling.remove()
      region.remove()
    }
  }
}

export async function renderEvidenceContent (
  target: HTMLElement, experiment: ExperimentDefinition, page: ExperimentPage
): Promise<void> {
  if (page.kind === 'live-checks' || !isReaderPage(experiment, page)) return
  const connected = target.isConnected
  // Load into a detached container so a cancelled navigation cannot leave table observers behind.
  const content = document.createElement('div')
  if (page.kind === 'markdown') {
    renderMarkdown(content, await page.load(), page.assets, {
      examples: page.examples,
      sectionNavigation: false,
      headingLevelOffset: 1,
      tables: false,
    })
    addArticleSections(content, experiment.id, page.id)
    removeReproductionInstructions(content)
    content.querySelector('[data-heading-level="1"]')?.remove()
  } else {
    const { renderReport } = await import('./report')
    renderReport(content, await page.load(), experiment.id)
  }
  if (connected && !target.isConnected) { disposeDocumentTables(content); return }
  unlinkOtherExperiments(content, experiment, page.kind === 'markdown' ? page.relatedExperiments : undefined)
  target.replaceChildren(...Array.from(content.childNodes))
  disposeDocumentTables(content)
  presentDocumentTables(target)
}

function mountCaseEvidence (recorded: HTMLElement, experiment: ExperimentDefinition): (section: string) => Promise<string | undefined> {
  const area = document.createElement('section'); area.className = 'case-evidence'
  type LoadEvidence = () => Promise<void>
  const documents = new Map<string, LoadEvidence>()
  const add = (page: ExperimentPage): LoadEvidence => {
    const existing = documents.get(page.id)
    if (existing) return existing
    if (!area.parentElement) recorded.append(area)
    const title = document.createElement('h2'); title.textContent = page.title
    const content = document.createElement('div'); content.id = articleSectionId(page.id); content.dataset.evidenceContent = ''
    let ready: Promise<void> | undefined
    const load = (): Promise<void> => {
      if (!ready) {
        const status = paragraph('Loading evidence…'); status.setAttribute('role', 'status'); content.replaceChildren(status)
        ready = renderEvidenceContent(content, experiment, page).catch(() => {
          content.replaceChildren(paragraph('Evidence could not load.'))
          const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry evidence'
          retry.addEventListener('click', () => { load().catch(() => {}) }); content.append(retry)
          ready = undefined
        })
      }
      return ready
    }
    area.append(title, content)
    documents.set(page.id, load)
    return load
  }
  const primaryEvidence = experiment.initialEvidence === 'first-recorded' ? startingCase(experiment).recorded?.evidence[0]?.page : undefined
  for (const page of caseEvidencePages(experiment)) {
    if (page.kind === 'live-checks') continue
    if (primaryEvidence && page.id !== primaryEvidence) continue
    add(page)().catch(() => {})
  }
  return async (section): Promise<string | undefined> => {
    const page = evidencePageAt(experiment, section)
    if (!page || !isReaderPage(experiment, page)) return undefined
    if (page.kind === 'live-checks') return articleSectionId(page.id)
    await add(page)()
    return articleSectionId(page.id)
  }
}

function mountComparison (
  stage: HTMLElement, slot: HTMLElement, experiment: ExperimentDefinition
): ((active: ExperimentCase, finding: string) => void) | undefined {
  const { howItWorks } = experiment
  if (howItWorks === false) return undefined
  const section = document.createElement('section'); section.className = 'case-comparison'
  stage.append(section)
  if (howItWorks) {
    section.id = 'run-explanation'
    slot.dataset.pageExplanation = ''
    const heading = document.createElement('h2'); heading.textContent = 'How it works'
    const content = document.createElement('div')
    renderMarkdown(content, howItWorks.summary, {}, { sectionNavigation: false, tables: false })
    unlinkOtherExperiments(content, experiment, howItWorks.relatedExperiments)
    section.append(heading, content)
    if (howItWorks.figure) {
      const figure = document.createElement('div')
      section.append(figure)
      howItWorks.figure(figure)
    }
    return undefined
  }
  section.id = 'case-comparison'
  section.innerHTML = '<h2>What this compares</h2><p class="case-description"></p><p class="case-instruction"></p>' +
    '<dl><dt>Reference</dt><dd></dd><dt>How to read the result</dt><dd></dd></dl>'
  const description = section.querySelector<HTMLElement>('.case-description')!
  const instruction = section.querySelector<HTMLElement>('.case-instruction')!
  const [reference, acceptance] = section.querySelectorAll('dd')
  return (active, finding) => {
    description.textContent = active.description
    description.hidden = active.description === finding
    instruction.textContent = active.tryIt?.trim() ?? ''
    instruction.hidden = !instruction.textContent
    reference.textContent = active.reference; acceptance.textContent = active.acceptance
  }
}

export function renderCaseFrame (host: HTMLElement, experiment: ExperimentDefinition): CaseFrame {
  const item = startingCase(experiment)
  const demo = experiment.presentation === 'demo'
  host.innerHTML = `<div class="reading-document case-document">
    <header class="case-header"><h1></h1><div class="case-recorded-summary"></div></header>
    <div class="case-stage" aria-busy="false">
      <div id="case-live">
        <div class="case-live-slot"></div>
        <p class="case-load-status" role="status"></p>
        <button type="button" data-retry-comparison hidden>Retry live experiment</button>
      </div>
    </div>
  </div>`
  const documentView = host.querySelector<HTMLElement>('.case-document')!
  const header = documentView.querySelector<HTMLElement>('.case-header')!
  const summary = header.querySelector<HTMLElement>('.case-recorded-summary')!
  header.querySelector('h1')!.textContent = experiment.title
  const topic = topicFor(experiment)
  addTopicLink(header, topic)
  const stage = documentView.querySelector<HTMLElement>('.case-stage')!
  const live = stage.querySelector<HTMLElement>('#case-live')!
  const slot = live.querySelector<HTMLElement>('.case-live-slot')!
  const status = live.querySelector<HTMLElement>('.case-load-status')!
  const retry = live.querySelector<HTMLButtonElement>('[data-retry-comparison]')!
  if (item.kind === 'recorded') live.remove()
  const navigation = experiment.showPeerLinks === false ? undefined : groupNavigation(experiment, topic)
  if (navigation) stage.after(navigation)
  const liveCases = experiment.cases!.filter(candidate => candidate.kind !== 'recorded')
  const caseButtons = new Map<ExperimentCase, HTMLButtonElement>()
  let chooser: HTMLSelectElement | undefined
  if (liveCases.length > 1) {
    const labelText = experiment.caseChooserLabel ?? 'Case'
    if (demo) {
      const group = document.createElement('div'); group.className = 'case-chooser choice-control'
      group.setAttribute('role', 'group'); group.setAttribute('aria-labelledby', 'case-chooser-label')
      const label = document.createElement('span'); label.id = 'case-chooser-label'; label.className = 'choice-label'; label.textContent = labelText
      const options = document.createElement('div'); options.className = 'choice-options'
      group.append(label, options)
      for (const candidate of liveCases) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = candidate.title
        caseButtons.set(candidate, button)
        options.append(button)
      }
      live.prepend(group)
    } else {
      const select = document.createElement('select')
      chooser = select
      for (const candidate of liveCases) {
        const option = document.createElement('option'); option.value = candidate.id; option.textContent = candidate.title; select.append(option)
      }
      const label = document.createElement('label'); label.className = 'case-chooser'
      label.append(document.createTextNode(labelText), select); live.prepend(label)
    }
  }
  const showRecordedSummary = experiment.showRecordedSummary !== false
  const recorded = showRecordedSummary ? recordedFindings(experiment) : document.createElement('div')
  if (!showRecordedSummary) summary.id = 'recorded-findings'
  const updateComparison = mountComparison(stage, slot, experiment)
  const setLiveCase = (active: ExperimentCase): void => {
    const assessment = readinessFor(experiment.id, active)
    const question = paragraph(active.question, 'case-question')
    if (experiment.headerContent === 'question-only') {
      if (!showRecordedSummary) question.id = findingSection(active)
      summary.replaceChildren(question)
    } else {
      const finding = paragraph(assessment.finding)
      if (!showRecordedSummary) finding.id = findingSection(active)
      summary.replaceChildren(readinessBadge(assessment.badge, assessment.tone), question, finding)
    }
    updateComparison?.(active, assessment.finding)
    if (chooser) chooser.value = active.id
    for (const [candidate, button] of caseButtons) button.setAttribute('aria-pressed', String(candidate.id === active.id))
  }
  setLiveCase(item)
  stage.append(recorded)
  const openEvidence = mountCaseEvidence(recorded, experiment)
  return {
    stage,
    slot,
    recorded,
    status,
    retry,
    openEvidence,
    setLiveCase,
    onChooseCase (choose): void {
      for (const [candidate, button] of caseButtons) button.addEventListener('click', () => choose(candidate, button))
      const select = chooser
      select?.addEventListener('change', () => {
        const candidate = liveCases.find(item => item.id === select.value)
        if (candidate) choose(candidate, select)
      })
    },
  }
}
