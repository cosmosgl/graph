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

export function renderResearchOverview (host: HTMLElement, experiment: ExperimentDefinition, record: ResearchSummary): void {
  const contract = validationContracts[experiment.id]
  host.innerHTML = `<section class="research-overview">
    <p class="research-meta">Research assessment · reviewed ${record.reviewed}</p><h2>Current finding</h2>
    <p class="research-conclusion">${record.conclusion}</p>
    <div class="research-actions"><a class="button-link" href="${runHref(experiment.id)}">Open run</a>
      <a href="${experimentHref(experiment.id, record.method)}">Read the method</a>
      <a href="${record.evidence ? experimentHref(experiment.id, record.evidence) : `#/${experiment.id}/evidence`}">
        ${record.evidence ? 'Inspect current evidence' : 'Evidence status'}</a></div>
    <dl class="research-summary"><div><dt>Scope</dt><dd>${record.scope}</dd></div>
      <div><dt>Next unresolved question</dt><dd>${record.next}</dd></div></dl>
    <p class="demo-note">${record.variant} · <a href="#/roadmap?section=milestone-${record.milestone}">${record.milestone} milestone</a></p>
    <p class="comparison-rail">${record.comparison}</p>
    <h3>Reproduce</h3><p>${record.reproduce}</p>
    <section class="research-contract"><h3>Comparison contract</h3><p>${contract.reference}</p>
      <a href="${experimentHref(experiment.id, record.method)}?section=reference">Reference, acceptance and limits in Method →</a>
    </section></section>`
}

export function renderEvidenceIndex (host: HTMLElement, experiment: ExperimentDefinition, record: ResearchSummary): void {
  const order = ['Current evidence', 'Supporting investigation', 'Historical baseline', 'Superseded', 'Parked']
  const investigations = record.investigations.slice().sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state))
  host.innerHTML = `<section class="evidence-index"><p class="research-meta">
    ${investigations.length ? 'Recorded research' : 'Evidence status'} · reviewed ${record.reviewed} · separate from the current run</p>
    <h2>Evidence and investigation history</h2><p>${record.conclusion}</p>
    <p>${record.scope}</p><p class="demo-note">${record.variant}.${investigations.length
  ? ' Each article identifies its measurement date or marks it as not recorded.'
  : ''}</p>
    ${investigations.length
    ? `<ul>${investigations.map(item => {
      const page = experiment.pages.find(page => page.id === item.page)!
      return `<li><span class="evidence-state">${item.state}</span><h3><a href="${experimentHref(experiment.id, item.page)}">${page.title}</a></h3>
      <p>${item.description}</p>${item.replacement ? `<a href="${experimentHref(experiment.id, item.replacement)}">Current conclusion →</a>` : ''}</li>`
    }).join('')}</ul>`
    : `<p>No recorded measurement matrix is published for this experiment yet.</p>
    <p>Run results describe this browser session. Reproduce the comparison and export measurements locally;
      completing a run does not create a published finding or approve the migration.</p>
    <a href="${runHref(experiment.id)}">Open run</a> · <a href="${experimentHref(experiment.id, record.method)}">Read the method</a>`}</section>`
}

export function renderInvestigationContext (host: HTMLElement, experiment: ExperimentDefinition, record: ResearchSummary, pageId: string): void {
  const item = record.investigations?.find(item => item.page === pageId)
  if (!item || !['Historical baseline', 'Superseded', 'Parked'].includes(item.state)) return
  const note = document.createElement('aside'); note.className = 'investigation-context'
  note.setAttribute('aria-label', 'Evidence status')
  note.innerHTML = `<p class="research-meta">${item.state}</p>
    <p>${item.description}</p>
    ${item.page !== record.evidence
    ? `<a href="${experimentHref(experiment.id, item.replacement ?? record.evidence)}">Current conclusion →</a>`
    : ''}`
  host.before(note)
}
