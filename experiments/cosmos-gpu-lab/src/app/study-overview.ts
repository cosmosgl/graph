import type { ExperimentDefinition } from '../runtime/experiment'
import { presentDocumentTables } from '../runtime/result-tables'
import { experimentHref } from './router'

function paragraph (label: string, text: string): HTMLParagraphElement {
  const element = document.createElement('p')
  const title = document.createElement('strong'); title.textContent = `${label}: `
  element.append(title, document.createTextNode(text))
  return element
}

export function renderStudyOverview (experiment: ExperimentDefinition): HTMLElement {
  const study = experiment.study!
  const { record } = study
  const section = document.createElement('section'); section.className = 'study-overview'
  section.id = 'study-overview'; section.setAttribute('aria-labelledby', 'study-overview-title')
  const title = document.createElement('h2'); title.id = 'study-overview-title'; title.textContent = 'Recorded result'
  const source = document.createElement('p'); source.className = 'study-source'
  source.textContent = `Recorded ${record.recordedAt} · ${record.environment} · Source revision: ${record.sourceRevision ?? 'Not recorded'}`
  const conclusion = document.createElement('p'); conclusion.className = 'research-conclusion'; conclusion.textContent = record.conclusion
  const table = document.createElement('table')
  const caption = document.createElement('caption'); caption.textContent = 'Checks in the recorded scope'
  const head = document.createElement('thead'); const headingRow = document.createElement('tr')
  for (const label of ['Check', 'Result', 'Observation']) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; headingRow.append(cell)
  }
  head.append(headingRow)
  const body = document.createElement('tbody')
  for (const check of record.checks) {
    const row = document.createElement('tr')
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = check.name; row.append(name)
    for (const value of [check.outcome, check.detail]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell) }
    body.append(row)
  }
  table.append(caption, head, body)
  const links = document.createElement('p'); links.className = 'study-links'
  const sourceLink = document.createElement('a'); sourceLink.href = experimentHref(experiment.id, record.sourcePage)
  sourceLink.textContent = 'Read the recorded evidence'
  const recipeLink = document.createElement('a'); recipeLink.href = experimentHref(experiment.id, study.recipePage)
  recipeLink.textContent = 'Reproduce with an agent'
  const researchLink = document.createElement('a'); researchLink.href = '#/validation-workflow'
  researchLink.textContent = 'Plan a new investigation'
  links.append(sourceLink, recipeLink, researchLink)
  section.append(title, source, conclusion, paragraph('Recorded question', record.question), paragraph('How it worked', record.method), table,
    paragraph('Scope', record.scope), paragraph('Limits', record.limits), paragraph('Visual evidence', record.visual), links)
  presentDocumentTables(section)
  return section
}
