import type { ExperimentCase, ExperimentDefinition, ExperimentPage } from '../runtime/experiment'
import { caseEvidenceLinks } from '../runtime/experiment'
import { articleSectionId, experimentSectionHref } from './router'

export function startingCase (experiment: ExperimentDefinition): ExperimentCase {
  const cases = experiment.cases!
  return cases.find(item => item.kind !== 'recorded') ?? cases[0]
}

export function findingSection (item: ExperimentCase): string {
  return `finding-${item.id}`
}

export function liveCaseSection (item: ExperimentCase): string {
  return `try-${item.id}`
}

export function evidencePageAt (experiment: ExperimentDefinition, section: string): ExperimentPage | undefined {
  if (experiment.singlePage || !section.startsWith('doc-')) return undefined
  return experiment.pages.filter(page => {
    const prefix = articleSectionId(page.id)
    return section === prefix || section.startsWith(`${prefix}-`)
  }).sort((left, right) => right.id.length - left.id.length)[0]
}

export function isReaderPage (experiment: ExperimentDefinition, page: ExperimentPage): boolean {
  return page.id !== experiment.study?.recipePage && !/\bagents?\b|\b(?:replay|reproduction) instructions\b/i.test(`${page.id} ${page.title}`)
}

export function caseEvidencePages (experiment: ExperimentDefinition): ExperimentPage[] {
  if (experiment.singlePage) return []
  const ids = new Set(experiment.cases!.flatMap(item => caseEvidenceLinks(item).map(link => link.page)))
  return experiment.pages.filter(page => ids.has(page.id) && isReaderPage(experiment, page))
}

export type ExperimentDestination = { href: string; section: string | null; liveCase?: ExperimentCase }

export function experimentDestination (experiment: ExperimentDefinition, requested: string | null): ExperimentDestination {
  let section = requested
  const page = evidencePageAt(experiment, section ?? '')
  if (section?.startsWith('doc-agent-recipe') || (page && !isReaderPage(experiment, page))) {
    section = 'recorded-findings'
  }

  const selectorCase = experiment.cases!.find(item => item.kind !== 'recorded' && section === liveCaseSection(item))
  const liveCase = selectorCase ?? (!section && experiment.presentation === 'demo' ? startingCase(experiment) : undefined)
  const href = experimentSectionHref(experiment.id, section)
  if (selectorCase) section = experiment.presentation === 'demo' ? null : 'case-live'
  return { href, liveCase, section }
}
