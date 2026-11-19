import type { ExperimentCase, ExperimentDefinition, ExperimentPage } from '../runtime/experiment'
import { caseEvidenceLinks } from '../runtime/experiment'
import { addArticleSections } from './article-sections'
import { unlinkOtherExperiments } from './independent-experiment'
import { experimentGroups } from './registry'
import { articleSectionId, caseEvidenceHref, caseHref, experimentHref } from './router'

function paragraph (text: string, className?: string): HTMLParagraphElement {
  const element = document.createElement('p')
  element.textContent = text
  if (className) element.className = className
  return element
}

function labeled (label: string, text: string): HTMLParagraphElement {
  const element = paragraph(text)
  const title = document.createElement('strong'); title.textContent = `${label}: `
  element.prepend(title)
  return element
}

function caseNavigation (experiment: ExperimentDefinition, item: ExperimentCase): HTMLElement | null {
  const others = experiment.cases?.filter(candidate => candidate.id !== item.id) ?? []
  const group = !others.length ? experimentGroups.find(entry => entry.experiments.some(candidate => candidate.id === experiment.id)) : undefined
  const peers = group?.experiments.filter(candidate => candidate.id !== experiment.id) ?? []
  if (!others.length && !peers.length) return null
  const label = `Other experiments in ${others.length ? experiment.title : group!.title}`
  const nav = document.createElement('nav'); nav.className = 'case-navigation'; nav.setAttribute('aria-label', label)
  if (!others.length) nav.classList.add('case-group-navigation')
  const list = document.createElement('ul')
  for (const candidate of others) {
    const entry = document.createElement('li'); const link = document.createElement('a')
    link.href = caseHref(experiment.id, candidate.id); link.textContent = candidate.title
    entry.append(link); list.append(entry)
  }
  for (const candidate of peers) {
    const entry = document.createElement('li'); const link = document.createElement('a')
    link.href = experimentHref(candidate.id); link.textContent = candidate.title
    entry.append(link); list.append(entry)
  }
  nav.append(paragraph(label), list)
  return nav
}

function recordedFinding (experiment: ExperimentDefinition, item: ExperimentCase): HTMLElement {
  const section = document.createElement('section'); section.className = 'case-recorded'
  section.id = 'recorded-findings'
  const title = document.createElement('h2'); title.textContent = 'Recorded finding'; section.append(title)
  if (item.recorded) {
    const finding = item.recorded
    section.append(paragraph(`${finding.date} · ${finding.environment}`, 'case-meta'), paragraph(finding.conclusion),
      labeled('Scope', finding.scope), labeled('Limits', finding.limits))
  } else {
    section.append(paragraph('No recorded finding is available for this case yet.'))
  }
  const evidenceLinks = caseEvidenceLinks(item)
  if (evidenceLinks.length) {
    const links = document.createElement('nav'); links.className = 'case-evidence-links'
    links.setAttribute('aria-label', item.recorded ? 'Evidence' : 'Method and evidence')
    for (const evidence of evidenceLinks) {
      const link = document.createElement('a'); link.textContent = evidence.label
      link.href = caseEvidenceHref(experiment.id, item.id, evidence.page, evidence.section)
      links.append(link)
    }
    section.append(links)
  }
  return section
}

export function renderCaseFrame (host: HTMLElement, experiment: ExperimentDefinition, item: ExperimentCase): {
  stage: HTMLElement; slot: HTMLElement; recorded: HTMLElement; comparison: HTMLElement; status: HTMLElement; retry: HTMLButtonElement;
} {
  host.innerHTML = `<div class="case-document"><header class="case-header"><p class="case-kind"></p><h1></h1>
    <p class="case-question"></p><p class="case-description"></p></header>
    <section class="case-stage" aria-busy="true"></section></div>`
  host.querySelector<HTMLElement>('.case-kind')!.textContent = item.kind === 'recorded' ? 'Recorded study' : ''
  host.querySelector('h1')!.textContent = item.title
  host.querySelector<HTMLElement>('.case-question')!.textContent = item.question
  host.querySelector<HTMLElement>('.case-description')!.textContent = item.description
  const navigation = caseNavigation(experiment, item)
  if (navigation && !navigation.classList.contains('case-group-navigation')) host.querySelector('.case-header')!.append(navigation)
  const stage = host.querySelector<HTMLElement>('.case-stage')!
  if (item.kind !== 'recorded') {
    const intro = document.createElement('section'); intro.className = 'case-intro'; intro.id = 'case-live'
    const heading = document.createElement('h2'); heading.textContent = 'Try it'; intro.append(heading)
    if (item.tryIt) intro.append(paragraph(item.tryIt))
    stage.append(intro)
  }
  const status = paragraph('', 'case-load-status'); status.setAttribute('role', 'status')
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry live experiment'; retry.hidden = true
  const slot = document.createElement('div'); slot.className = 'case-live-slot'
  const recorded = recordedFinding(experiment, item)
  if (item.kind !== 'recorded') stage.append(status, retry, slot)
  stage.append(recorded)
  const comparison = document.createElement('section'); comparison.className = 'case-comparison'; comparison.id = 'case-comparison'
  const heading = document.createElement('h2'); heading.textContent = 'What this compares'
  comparison.append(heading, labeled('Reference', item.reference), labeled('How to read the result', item.acceptance))
  stage.append(comparison)
  if (navigation?.classList.contains('case-group-navigation')) stage.append(navigation)
  return { stage, slot, recorded, comparison, status, retry }
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

export async function renderCaseEvidence (
  host: HTMLElement, experiment: ExperimentDefinition, item: ExperimentCase, page: ExperimentPage
): Promise<void> {
  host.innerHTML = `<div class="case-evidence-page"><p><a data-back></a></p><header><p class="case-meta"></p><h1></h1></header>
    <div data-evidence-content><p>Loading evidence…</p></div></div>`
  const back = host.querySelector<HTMLAnchorElement>('[data-back]')!
  back.href = caseHref(experiment.id, item.id); back.textContent = `← ${item.title}`
  host.querySelector<HTMLElement>('.case-meta')!.textContent = `${item.title} · Evidence`
  host.querySelector('h1')!.textContent = page.title
  const navigation = caseNavigation(experiment, item)
  if (navigation) {
    if (navigation.classList.contains('case-group-navigation')) host.querySelector('[data-evidence-content]')!.after(navigation)
    else host.querySelector('.case-evidence-page header')!.after(navigation)
  }
  const target = host.querySelector<HTMLElement>('[data-evidence-content]')!
  target.id = articleSectionId(page.id)
  if (page.kind === 'markdown') {
    const { renderMarkdown } = await import('./markdown')
    await renderMarkdown(target, await page.load(), page.assets, { sectionNavigation: false, headingLevelOffset: 1 })
    addArticleSections(target, experiment.id, page.id)
    removeReproductionInstructions(target)
    // A document's own h1 duplicates the page title above; keep its old anchor.
    const title = target.querySelector<HTMLElement>('[data-heading-level="1"]')
    if (title) { host.querySelector('h1')!.id = title.id; title.remove() }
  } else {
    const { renderReport } = await import('./report')
    renderReport(target, await page.load(), experiment.id)
  }
  // Old in-document links still go through the experiment router.
  for (const link of target.querySelectorAll<HTMLAnchorElement>('a[href^="#/"]')) {
    const href = link.getAttribute('href')!
    if (href === experimentHref(experiment.id)) link.href = caseHref(experiment.id, item.id)
    else if (href.startsWith(`${experimentHref(experiment.id)}?`)) {
      const params = new URLSearchParams(href.split('?')[1])
      if (!params.has('case')) { params.set('case', item.id); link.href = `${experimentHref(experiment.id)}?${params}` }
    }
  }
  unlinkOtherExperiments(target, experiment, item, page.id)
}
