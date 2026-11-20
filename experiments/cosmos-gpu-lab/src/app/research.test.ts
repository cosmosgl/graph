import { expect, it } from 'vitest'
import { experiments, findExperiment } from './registry'
import { research, researchMethodPages } from './research'
import { renderInvestigationContext } from './research-ui'

it('assigns every experiment and document to the shared research destinations without dropping history', () => {
  expect(Object.keys(research).sort()).toEqual(experiments.map(e => e.id).sort())
  for (const [id, record] of Object.entries(research)) {
    const experiment = findExperiment(id)!
    expect(experiment).toBeDefined()
    if (record.evidence) expect(experiment.pages.some(page => page.id === record.evidence)).toBe(true)
    expect(experiment.pages.some(page => page.id === record.method)).toBe(true)
    for (const method of record.methods ?? []) expect(experiment.pages.some(page => page.id === method.page)).toBe(true)
    const indexed = record.investigations.map(item => item.page)
    const caseEvidence = experiment.cases?.flatMap(item => [...item.evidence ?? [], ...item.recorded?.evidence ?? []].map(link => link.page)) ?? []
    expect(new Set(indexed).size).toBe(indexed.length)
    for (const page of experiment.pages) {
      expect([...researchMethodPages(record), ...indexed, ...caseEvidence]).toContain(page.id)
    }
    for (const page of caseEvidence) expect(experiment.pages.some(item => item.id === page)).toBe(true)
    for (const item of record.investigations) {
      expect(experiment.pages.some(page => page.id === item.page)).toBe(true)
      if (item.replacement) expect(indexed).toContain(item.replacement)
    }
  }
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
