import type { ExperimentDefinition } from '../runtime/experiment'
import { validationContracts } from '../runtime/validation'
import { findExperiment } from './registry'
import { experimentHref, runHref } from './router'
import { mainOpenIssues, migrationFocus, milestones, research, REVIEWED, type ResearchSummary } from './research'

export function renderMigrationOverview (host: HTMLElement, detailed = false): void {
  const current = milestones.find(m => m.id === migrationFocus.milestone)!
  const focus = research[migrationFocus.experiment]
  const contract = validationContracts[migrationFocus.experiment]
  host.innerHTML = `<section class="migration-overview" aria-label="Current migration assessment">
    <p class="research-meta">Recorded assessment · reviewed ${new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(REVIEWED))}</p>
    <section class="migration-current" aria-labelledby="migration-current-title" data-decision="milestone">
      <h2 id="migration-current-title">Current milestone</h2>
      <p><a href="#/roadmap?section=milestone-${current.id}">${current.title}</a> · ${migrationFocus.phase}</p>
      <p class="advance-scope">${migrationFocus.status}</p>
    </section>
    <div class="readiness-columns migration-decisions">
    <section class="migration-successes" aria-labelledby="migration-successes-title" data-decision="successes">
      <h2 id="migration-successes-title">Demonstrated successes</h2><ul>${migrationFocus.demonstrated.map(id => {
    const record = research[id]
    return `<li><a href="${experimentHref(id, record.evidence)}">${findExperiment(id)!.title}</a>
      <p>${record.conclusion}</p><p class="advance-scope">Scope: ${record.scope}</p></li>`
  }).join('')}</ul></section>
    <div class="migration-next-steps">
      <section aria-labelledby="migration-blockers-title" data-decision="blockers">
        <h2 id="migration-blockers-title">Main blockers</h2>
        <ul>${mainOpenIssues.map(issue => `<li><a href="${issue.href}">${issue.text}</a></li>`).join('')}</ul>
      </section>
      <section class="migration-next-gate" aria-labelledby="migration-next-gate-title" data-decision="gate">
        <h2 id="migration-next-gate-title">Next acceptance gate</h2>
        <p>${current.gates[0]}</p><p class="advance-scope">${contract.acceptance}</p>
        <div class="migration-links">
          <a href="${runHref(migrationFocus.experiment)}">Run styling and picking</a>
          <a href="${experimentHref(migrationFocus.experiment, focus.evidence)}">Recorded controls</a>
          <a href="${experimentHref(migrationFocus.experiment, focus.method)}?section=acceptance">Acceptance criteria</a>
        </div>
      </section>
    </div></div>
    <nav class="migration-links" aria-label="Migration reference">
      <a href="#/roadmap">All milestones and gates</a>
      <a href="#/feature-inventory">Feature coverage</a>
      <a href="#/validation-workflow">How evidence is judged</a>
    </nav>
    </section>`
  if (detailed) {
    const gates = document.createElement('section'); gates.className = 'milestone-gates'
    gates.innerHTML = `<div class="readiness-table"><table><caption>Migration milestones</caption>
      <thead><tr><th>Milestone</th><th>Current position</th><th>Main remaining gate</th></tr></thead><tbody>
      ${milestones.map(m => `<tr><th><a href="#/roadmap?section=milestone-${m.id}">${m.title}</a></th>
        <td>${m.position}</td><td>${m.acceptance}</td></tr>`).join('')}</tbody></table></div>
      <h2>Milestone acceptance checklists</h2>${milestones.map(m => `<section id="milestone-${m.id}">
      <h3>${m.title}</h3><p>${m.position}.</p><ul>${m.gates.map(gate => `<li>${gate}</li>`).join('')}</ul>
      <p>Evidence: ${m.evidence.map(([id, title]) => `<a href="${experimentHref(id)}">${title}</a>`).join(' · ')}.</p>
      </section>`).join('')}`
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
