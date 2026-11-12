import { expect, it } from 'vitest'
import { validationContracts } from '../runtime/validation'
import { experiments, findExperiment } from './registry'
import { mainOpenIssues, migrationFocus, milestones, research, researchMethodPages } from './research'
import { renderInvestigationContext, renderMigrationOverview } from './research-ui'

it('assigns every experiment and document to the shared research destinations without dropping history', () => {
  expect(Object.keys(research).sort()).toEqual(experiments.map(e => e.id).sort())
  for (const [id, record] of Object.entries(research)) {
    const experiment = findExperiment(id)!
    expect(experiment).toBeDefined()
    if (record.evidence) expect(experiment.pages.some(page => page.id === record.evidence)).toBe(true)
    expect(experiment.pages.some(page => page.id === record.method)).toBe(true)
    const indexed = record.investigations.map(item => item.page)
    expect(new Set(indexed).size).toBe(indexed.length)
    for (const page of experiment.pages) {
      expect([...researchMethodPages(record), ...indexed]).toContain(page.id)
    }
    for (const item of record.investigations) {
      expect(experiment.pages.some(page => page.id === item.page)).toBe(true)
      if (item.replacement) expect(indexed).toContain(item.replacement)
    }
  }
  for (const milestone of milestones) for (const [id] of milestone.evidence) expect(findExperiment(id)).toBeDefined()
})

it('derives the bounded home assessment from shared experiment records', () => {
  const home = document.createElement('div')
  renderMigrationOverview(home)
  expect(home.textContent).toContain(research.collision.conclusion)
  expect(Array.from(home.querySelectorAll<HTMLElement>('[data-decision]'), section => section.dataset.decision))
    .toEqual(['milestone', 'successes', 'blockers', 'gate'])
  const current = milestones.find(m => m.id === migrationFocus.milestone)!
  expect(home.querySelector('[data-decision="milestone"]')!.textContent).toContain(current.title)
  expect(home.querySelector('[data-decision="gate"]')!.textContent).toContain(current.gates[0])
  expect(home.querySelector('[data-decision="gate"]')!.textContent).toContain(validationContracts[migrationFocus.experiment].acceptance)
  for (const id of migrationFocus.demonstrated) {
    expect(home.querySelector('.migration-successes')!.textContent).toContain(research[id].conclusion)
    expect(home.querySelector('.migration-successes')!.textContent).toContain(research[id].scope)
  }
  for (const issue of mainOpenIssues) expect(home.querySelector(`a[href="${issue.href}"]`)).not.toBeNull()
  expect(home.querySelector('details')).toBeNull()
})

it('keeps the complete milestone table, gates and deep links visible on Roadmap', () => {
  const host = document.createElement('div')
  renderMigrationOverview(host, true)
  expect(host.querySelectorAll('.readiness-table tbody tr')).toHaveLength(milestones.length)
  for (const milestone of milestones) {
    const section = host.querySelector(`#milestone-${milestone.id}`)!
    expect(section).not.toBeNull()
    for (const gate of milestone.gates) expect(section.textContent).toContain(gate)
  }
  expect(host.querySelector('details,[hidden]')).toBeNull()
})

it('preserves earlier findings, their warnings and links to corrected work', () => {
  for (const experiment of experiments) {
    for (const item of research[experiment.id].investigations) {
      if (!['Historical baseline', 'Superseded', 'Parked'].includes(item.state)) continue
      const container = document.createElement('div'); const article = document.createElement('div'); container.append(article)
      renderInvestigationContext(article, experiment, research[experiment.id], item.page)
      expect(container.querySelector('.investigation-context')!.textContent).toContain(item.description)
      if (item.page !== research[experiment.id].evidence) expect(container.querySelector('.investigation-context a')).not.toBeNull()
      expect(container.querySelector('details')).toBeNull()
    }
  }
})
