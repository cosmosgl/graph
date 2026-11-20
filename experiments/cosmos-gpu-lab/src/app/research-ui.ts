import type { ExperimentDefinition } from '../runtime/experiment'
import { experimentHref } from './router'
import type { ResearchSummary } from './research'

export function renderInvestigationContext (host: HTMLElement, experiment: ExperimentDefinition, record: ResearchSummary, pageId: string): void {
  const item = record.investigations?.find(item => item.page === pageId)
  if (!item || !['Historical baseline', 'Superseded', 'Parked'].includes(item.state)) return
  const note = document.createElement('aside'); note.className = 'investigation-context'
  note.setAttribute('aria-label', 'Recorded finding context')
  note.innerHTML = `<p class="research-meta">${item.state === 'Parked' ? 'Unresolved investigation' : 'Earlier result'}</p>
    <p>${item.description}</p>
    ${item.page !== record.evidence
    ? `<a href="${experimentHref(experiment.id, item.replacement ?? record.evidence)}">Current conclusion →</a>`
    : ''}`
  host.before(note)
}
