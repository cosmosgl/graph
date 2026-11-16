import type { ExperimentDefinition } from '../runtime/experiment'
import { experimentHref, runHref } from './router'
import { mainOpenIssues, migrationFocus, milestones, research, type ResearchSummary } from './research'
import { focusedExperiment, currentStep, currentJourneyStep } from './journey'

export function renderMigrationOverview (host: HTMLElement, detailed = false): void {
  const focus = research[migrationFocus.experiment]
  const current = milestones.find(m => m.id === focus.milestone)!
  const experiment = focusedExperiment()
  host.innerHTML = `<section class="migration-overview" aria-label="Current migration assessment">
    <p class="research-meta">Current investigation · reviewed ${new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(focus.reviewed))}</p>
    <section data-decision="focus"><h2><a href="${runHref(experiment.id)}">${experiment.title}</a></h2>
      <p>${focus.conclusion}</p></section>
    <section data-decision="next"><p><strong>Next:</strong> ${focus.next}</p>
      <p><a href="#/roadmap?section=journey-${currentJourneyStep().id}">Step ${currentStep} · ${currentJourneyStep().title}</a>
        · Active area: ${current.title}. Execution, simulation and production acceptance remain open.</p></section>
    </section>`
  if (detailed) {
    const gates = document.createElement('section'); gates.className = 'milestone-gates'
    gates.innerHTML = `<div class="readiness-table"><table><caption>Migration milestones</caption>
      <thead><tr><th>Milestone</th><th>Current position</th><th>Main remaining gate</th></tr></thead><tbody>
      ${milestones.map(m => `<tr><th><a href="#/roadmap?section=milestone-${m.id}">${m.title}</a></th>
        <td>Open · ${m.position}</td><td>${m.acceptance}</td></tr>`).join('')}</tbody></table></div>
      <h2>Open milestone checklists</h2>${milestones.map(m => `<section id="milestone-${m.id}">
      <h3>${m.title}</h3><p>${m.position}.</p><ul>${m.gates.map(gate => `<li>${gate}</li>`).join('')}</ul>
      <p>Evidence: ${m.evidence.map(([id, title]) => `<a href="${experimentHref(id)}">${title}</a>`).join(' · ')}.</p>
      </section>`).join('')}`
    gates.insertAdjacentHTML('beforeend', `<h2>Cross-cutting work still open</h2><ul>${mainOpenIssues.map(issue =>
      `<li><a href="${issue.href}">${issue.text}</a></li>`).join('')}</ul>`)
    host.append(gates)
  }
}

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
