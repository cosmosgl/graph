import type { ExperimentCase, ExperimentDefinition, ExperimentPage } from '../runtime/experiment'
import { disposeDocumentTables, presentDocumentTables } from '../runtime/result-tables'
import { addArticleSections } from './article-sections'
import { experimentMiniCard } from './experiment-mini-card'
import { caseEvidencePages, evidencePageAt, findingSection, isReaderPage, startingCase } from './experiment-route'
import { unlinkOtherExperiments } from './independent-experiment'
import { experimentGroups } from './registry'
import { readinessFor } from './readiness'
import { readinessBadge, recordedObservations } from './readiness/presentation'
import { articleSectionId, experimentHref, experimentSectionHref } from './router'

type CaseFrame = {
  stage: HTMLElement;
  slot: HTMLElement;
  recorded: HTMLElement;
  comparison: HTMLElement;
  status: HTMLElement;
  retry: HTMLButtonElement;
  start: HTMLButtonElement;
  chooser: HTMLSelectElement;
  openEvidence: (section: string) => Promise<string | undefined>;
  setLiveCase: (active: ExperimentCase) => void;
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
      row.append(paragraph(observation.evidence), paragraph(observation.limits, 'case-observation-limits'))
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
      row.append(result, limits); list.append(row)
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
  if (!isReaderPage(experiment, page)) return
  const connected = target.isConnected
  // Load into a detached container so a cancelled navigation cannot leave table observers behind.
  const content = document.createElement('div')
  if (page.kind === 'markdown') {
    const { renderMarkdown } = await import('./markdown')
    await renderMarkdown(content, await page.load(), page.assets, { sectionNavigation: false, headingLevelOffset: 2, tables: false })
    addArticleSections(content, experiment.id, page.id)
    removeReproductionInstructions(content)
    content.querySelector('[data-heading-level="1"]')?.remove()
  } else {
    const { renderReport } = await import('./report')
    renderReport(content, await page.load(), experiment.id)
  }
  if (connected && !target.isConnected) { disposeDocumentTables(content); return }
  unlinkOtherExperiments(content, experiment)
  target.replaceChildren(...Array.from(content.childNodes))
  disposeDocumentTables(content)
  presentDocumentTables(target)
}

function mountCaseEvidence (recorded: HTMLElement, experiment: ExperimentDefinition): (section: string) => Promise<string | undefined> {
  const inline = experiment.presentation === 'demo'
  const area = document.createElement('section'); area.className = 'case-evidence'
  if (!inline) {
    const heading = document.createElement('h3'); heading.textContent = 'Detailed evidence'; area.append(heading)
  }
  type EvidenceBlock = { disclosure?: HTMLDetailsElement; load: () => Promise<void> }
  const documents = new Map<string, EvidenceBlock>()
  const add = (page: ExperimentPage): EvidenceBlock => {
    const existing = documents.get(page.id)
    if (existing) return existing
    if (!area.parentElement) recorded.append(area)
    const disclosure = inline ? undefined : document.createElement('details')
    const title = document.createElement(inline ? 'h3' : 'summary'); title.textContent = page.title
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
    if (disclosure) {
      disclosure.className = 'advanced-controls case-evidence-detail'
      disclosure.addEventListener('toggle', () => { if (disclosure.open) load().catch(() => {}) })
      disclosure.append(title, content); area.append(disclosure)
    } else area.append(title, content)
    const block = { disclosure, load }; documents.set(page.id, block)
    return block
  }
  for (const page of caseEvidencePages(experiment)) {
    const block = add(page)
    if (inline) block.load().catch(() => {})
  }
  return async (section): Promise<string | undefined> => {
    const page = evidencePageAt(experiment, section)
    if (!page || !isReaderPage(experiment, page)) return undefined
    const block = add(page)
    if (block.disclosure) block.disclosure.open = true
    await block.load()
    return articleSectionId(page.id)
  }
}

export function renderCaseFrame (host: HTMLElement, experiment: ExperimentDefinition): CaseFrame {
  const item = startingCase(experiment)
  const demo = experiment.presentation === 'demo'
  host.innerHTML = `<div class="case-document case-single-page"><header class="case-header"><p class="case-kind"></p><h1></h1>
    <p class="case-question"></p><p class="case-description"></p></header><section class="case-stage" aria-busy="false"></section></div>`
  const header = host.querySelector('.case-header')!
  const question = header.querySelector<HTMLElement>('.case-question')!
  question.hidden = demo
  const description = header.querySelector<HTMLElement>('.case-description')!
  header.querySelector('h1')!.textContent = experiment.title
  header.querySelector<HTMLElement>('.case-kind')!.textContent = item.kind === 'recorded' ? 'Recorded study' : ''
  const topic = topicFor(experiment)
  if (topic) {
    const link = document.createElement('a'); link.className = 'case-topic-link'; link.href = `#/?section=catalog-${topic.id}`
    const arrow = document.createElement('span'); arrow.textContent = '← '; arrow.setAttribute('aria-hidden', 'true')
    link.append(arrow, document.createTextNode(topic.title)); header.prepend(link)
  }
  const summary = document.createElement('div'); summary.className = 'case-recorded-summary'
  if (!demo) header.append(summary)

  const stage = host.querySelector<HTMLElement>('.case-stage')!
  const navigation = demo ? undefined : groupNavigation(experiment, topic)
  if (navigation) stage.after(navigation)
  const intro = document.createElement('section'); intro.className = 'case-intro'
  const title = document.createElement('h2'); title.textContent = 'Try it'
  const instruction = paragraph('')
  intro.append(title, instruction)
  const chooser = document.createElement('select')
  const liveCases = experiment.cases!.filter(candidate => candidate.kind !== 'recorded')
  if (liveCases.length > 1) {
    for (const candidate of liveCases) {
      const option = document.createElement('option'); option.value = candidate.id; option.textContent = candidate.title; chooser.append(option)
    }
    const label = document.createElement('label'); label.className = 'case-chooser'
    label.append(document.createTextNode(experiment.caseChooserLabel ?? 'Case'), chooser); intro.insertBefore(label, instruction)
  }
  const slot = document.createElement('div'); slot.className = 'case-live-slot'
  const status = paragraph('', 'case-load-status'); status.setAttribute('role', 'status')
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry live experiment'; retry.hidden = true
  const start = document.createElement('button'); start.type = 'button'; start.textContent = 'Start the live comparison'
  start.className = 'button-primary'; start.hidden = true
  if (item.kind !== 'recorded') {
    const liveEntry = liveCases.length > 1 || item.tryIt?.trim() ? intro : stage
    liveEntry.id = 'case-live'
    if (liveEntry === intro) stage.append(intro)
    stage.append(status, start, retry, slot)
  }
  const recorded = recordedFindings(experiment)
  const comparison = document.createElement('section'); comparison.className = 'case-comparison'; comparison.id = 'case-comparison'
  comparison.innerHTML = '<h2>What this compares</h2><dl><dt>Reference</dt><dd></dd><dt>How to read the result</dt><dd></dd></dl>'
  const [reference, acceptance] = comparison.querySelectorAll('dd')
  const setLiveCase = (active: ExperimentCase): void => {
    question.textContent = active.question; description.textContent = active.description
    const guidance = active.tryIt?.trim() ?? ''
    instruction.textContent = guidance
    title.hidden = instruction.hidden = !guidance
    chooser.value = active.id
    reference.textContent = active.reference; acceptance.textContent = active.acceptance
    if (demo) return
    const assessment = readinessFor(experiment.id, active)
    summary.replaceChildren(readinessBadge(assessment.badge, assessment.tone), paragraph(assessment.finding))
    const evidence = active.recorded?.evidence[0] ?? active.evidence?.[0]
    if (evidence) {
      const details = document.createElement('a')
      details.href = experiment.singlePage
        ? experimentSectionHref(experiment.id, 'recorded-findings')
        : experimentHref(experiment.id, evidence.page, evidence.section)
      details.textContent = active.recorded ? 'View test details' : evidence.label
      summary.append(details)
    }
  }
  setLiveCase(item)
  stage.append(recorded, comparison)
  const openEvidence = mountCaseEvidence(recorded, experiment)
  return { stage, slot, recorded, comparison, status, retry, start, chooser, openEvidence, setLiveCase }
}
