import type { ExperimentDefinition } from '../runtime/experiment'
import { findExperiment } from './registry'
import { migrationFocus, milestones, research } from './research'
import { experimentHref } from './router'
export const currentStep = migrationFocus.step
export const journeySteps = [
  {
    number: 1,
    id: 'polygon-boundaries',
    title: 'Polygon boundaries',
    status: 'Closed with retained failures',
    position: 'The focused investigation is closed; rejected reference/color counterexamples remain open.',
    exit: 'Replayable counterexamples retained; no acceptance or production change.',
    href: '#/point-styling',
  },
  {
    number: 2,
    id: 'link-rendering',
    title: 'Link rendering',
    status: 'Planned',
    position: 'Validate remaining link styles and retain native mask/color blockers.',
    exit: 'Declared color, exact ID/mask and source-visibility gates; remaining styles still need validation.',
    href: '#/roadmap?section=milestone-rendering',
  },
  {
    number: 3,
    id: 'missing-forces',
    title: 'Missing force families',
    status: 'Planned',
    position: 'Per-point attractors → clusters → mouse repulsion; then compose them in production order.',
    exit: 'Isolated and composed WebGL/WebGPU/CPU agreement at unchanged tolerances.',
    href: '#/feature-inventory?section=1-simulation-forces',
  },
  {
    number: 4,
    id: 'graph-integration',
    title: 'Small Graph integration',
    status: 'Planned',
    position: 'Resident simulation, styled rendering, updates and picking through the production API.',
    exit: 'Supported API, ownership, host and lifecycle contracts exercised together.',
    href: '#/roadmap?section=milestone-integration',
  },
  {
    number: 5,
    id: 'production-envelope',
    title: 'Production envelope',
    status: 'Planned',
    position: 'Larger complete graphs, agreed quality/cost budgets and intended native devices.',
    exit: 'Feature, quality, latency, memory and portability acceptance before switching production.',
    href: '#/roadmap?section=milestone-production',
  },
] as const
export function currentJourneyStep (): typeof journeySteps[number] { return journeySteps.find(step => step.number === currentStep)! }
export function focusedExperiment (): ExperimentDefinition { return findExperiment(migrationFocus.experiment)! }
export function experimentRole (id: string): string {
  if (id === migrationFocus.experiment) return 'Current investigation'
  const record = research[id]
  if (record.evidence && record.investigations.find(item => item.page === record.evidence)?.state === 'Parked') return 'Parked'
  if (['center-mass', 'scalable-reduction', 'spatial-grid', 'point-rendering', 'performance-lab'].includes(id)) return 'Foundation'
  return 'Bounded study'
}
export function milestoneTitle (id: string): string { return milestones.find(m => m.id === id)!.title }
export function renderJourney (host: HTMLElement): void {
  host.innerHTML = `<div class="readiness-table"><table>
    <thead><tr><th>Step</th><th>Status</th><th>Position / next action</th><th>Exit evidence</th></tr></thead>
    <tbody>${journeySteps.map(step => {
    const active = step.number === currentStep
    const href = active ? experimentHref(migrationFocus.experiment) : step.href
    const position = active ? research[migrationFocus.experiment].next : step.position
    return `<tr id="journey-${step.id}"><th>${step.number}. <a href="${href}">${step.title}</a></th>
      <td>${active ? 'Current' : step.status}</td><td>${position}</td><td>${step.exit}</td></tr>`
  }).join('')}</tbody></table></div>
    <p>These are ordered research tasks, not completed migration milestones. ${milestoneTitle('execution')} and
      ${milestoneTitle('simulation')} remain open alongside the active ${milestoneTitle('rendering')} work.</p>`
}
export function renderJourneyFlow (host: HTMLElement): void {
  const label = (id: string): string => {
    const milestone = milestones.find(m => m.id === id)!
    return `<span class="flow-title">${milestone.title}</span><span class="flow-detail">Open · ${milestone.position}</span>`
  }
  host.innerHTML = `<ol class="doc-flow"><li class="flow-step">${label('execution')}</li>
    <li class="flow-fork"><ul class="flow-branches"><li>${label('simulation')}</li><li>${label('rendering')}</li></ul></li>
    <li class="flow-step">${label('integration')}</li><li class="flow-step">${label('production')}</li></ol>
    <p>These workstreams overlap; their order is not a completion claim.
      The five-row research plan above records what we work on next.</p>`
}
