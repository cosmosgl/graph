import { expect, it } from 'vitest'
import { findExperiment } from './registry'
import { milestones, research } from './research'
import { renderEvidenceIndex, renderMigrationOverview, renderResearchOverview } from './research-ui'

it('links current summaries and every pilot investigation to existing pages without dropping history', () => {
  for (const [id, record] of Object.entries(research)) {
    const experiment = findExperiment(id)!
    expect(experiment).toBeDefined(); expect(experiment.pages.some(page => page.id === record.evidence)).toBe(true)
    if (!record.pilot) continue
    expect(experiment.pages.some(page => page.id === record.method)).toBe(true)
    const indexed = record.investigations!.map(item => item.page)
    expect(new Set(indexed).size).toBe(indexed.length)
    for (const page of experiment.pages) {
      if (page.id !== record.method && page.id !== 'validation-contract') expect(indexed).toContain(page.id)
    }
    for (const item of record.investigations!) {
      expect(experiment.pages.some(page => page.id === item.page)).toBe(true)
      if (item.replacement) expect(indexed).toContain(item.replacement)
    }
  }
  for (const milestone of milestones) for (const [id] of milestone.evidence) expect(findExperiment(id)).toBeDefined()
})

it('derives the home conclusion and overview from one record and keeps historical evidence visible', () => {
  const home = document.createElement('div'); const overview = document.createElement('div'); const index = document.createElement('div')
  renderMigrationOverview(home); renderResearchOverview(overview, findExperiment('collision')!, research.collision)
  renderEvidenceIndex(index, findExperiment('collision')!, research.collision)
  expect(home.textContent).toContain(research.collision.conclusion); expect(overview.textContent).toContain(research.collision.conclusion)
  expect(home.querySelector('.readiness-table')!.compareDocumentPosition(home.querySelector('.readiness-columns')!))
    .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  expect(overview.querySelector('details')).toBeNull()
  expect(overview.querySelector('.research-contract a')?.getAttribute('href')).toBe('#/collision/docs/method?section=reference')
  expect(index.textContent).toContain('Historical baseline'); expect(index.querySelector('a[href="#/collision/docs/trajectories"]')).not.toBeNull()
})
