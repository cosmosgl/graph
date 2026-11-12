import type { ExperimentDefinition } from '../runtime/experiment'
import { validationContracts } from '../runtime/validation'
import { findExperiment } from './registry'
import { experimentHref, runHref } from './router'
import { mainOpenIssues, milestones, research, REVIEWED, type ResearchSummary } from './research'

export function renderMigrationOverview (host: HTMLElement, detailed = false): void {
  const advances = ['collision', 'matched-layout', 'point-styling']
  host.innerHTML = `<section class="migration-overview" aria-label="Current migration assessment">
    <p class="research-meta">Recorded assessment · reviewed ${new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(REVIEWED))}</p>
    <h2>Current phase: prototype validation</h2>
    <p>Production Cosmos still uses WebGL. Integration and production acceptance remain open.</p>
    <p class="migration-next"><strong>Next priority:</strong> ${research['point-styling'].next}
      <a href="#/roadmap?section=3-the-next-work-in-order">Acceptance plan →</a></p>
    <div class="readiness-table"><table><caption>Migration milestones</caption>
      <thead><tr><th>Milestone</th><th>Current position</th><th>Main remaining gate</th></tr></thead><tbody>
      ${milestones.map(m => `<tr><th><a href="#/roadmap?section=milestone-${m.id}">${m.title}</a></th>
        <td>${m.position}</td><td>${m.acceptance}</td></tr>`).join('')}</tbody></table></div>
    <div class="readiness-columns"><section><h3>Recent advances</h3><ul>${advances.map(id => {
    const record = research[id]
    return `<li><a href="${experimentHref(id, record.evidence)}">${findExperiment(id)!.title}</a>
      <p>${record.conclusion}</p><p class="advance-scope">${record.scope}</p></li>`
  }).join('')}</ul></section><section><h3>Main open issues</h3><ol>${mainOpenIssues.map(issue => `<li>${issue}</li>`).join('')}</ol>
      </section></div>
    <p class="demo-note">Recorded findings, not this browser’s live run. No overall completion percentage is assigned.
      <a href="#/feature-inventory">Detailed feature coverage</a> · <a href="#/validation-workflow">How evidence is judged</a></p>
    </section>`
  if (detailed) {
    const gates = document.createElement('section'); gates.className = 'milestone-gates'
    gates.innerHTML = `<h2>Milestone acceptance checklists</h2>${milestones.map(m => `<section id="milestone-${m.id}">
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
