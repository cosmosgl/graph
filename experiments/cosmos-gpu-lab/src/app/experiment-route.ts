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
  if (experiment.id === 'integrated-webgpu') {
    if (section === 'case-comparison') section = 'run-explanation'
    if (section === 'recorded-findings') section = 'doc-overview'
    const finding = experiment.cases?.find(item => findingSection(item) === section)
    const evidence = finding?.recorded?.evidence[0]
    if (evidence) section = articleSectionId(evidence.page, evidence.section)
  }
  if (experiment.id === 'integrated-webgpu-benchmarks' && section === 'run-diagnostics') section = 'benchmark-controls'
  if (experiment.id === 'scalable-reduction') {
    if (section === 'case-comparison' || /^doc-algorithm(?:-|$)/.test(section ?? '')) section = 'run-explanation'
    if (section === 'run-diagnostics') section = 'reduction-benchmark'
  }
  if (experiment.id === 'curved-links') {
    if (section === 'run-more-settings') section = 'run-configuration'
    if (section === 'case-comparison') section = 'run-explanation'
    if (section?.startsWith('doc-method-folded-ribbon')) section = 'doc-case-evidence-folded-ribbon'
    else if (section?.startsWith('doc-method-default-bow')) section = 'doc-case-evidence-default-bow'
    else if (/^doc-method-(?:pattern|dash|endpoint|faint)/.test(section ?? '')) section = 'doc-case-evidence-archived-styles'
    else if (/^doc-method(?:-|$)/.test(section ?? '') || section === 'doc-case-evidence-what-was-compared' ||
      section === 'recorded-findings' || section === 'run-diagnostics') section = 'doc-case-evidence'
  }
  if (experiment.id === 'straight-links') {
    if (section === 'run-more-settings') section = 'run-configuration'
    if (section === 'run-diagnostics' || /^doc-case-evidence(?:-|$)/.test(section ?? '')) section = 'doc-automated-cases'
    else if (section?.startsWith('doc-method-endpoint-gradients')) section = 'run-configuration'
    else if (section === 'case-comparison' || /^doc-method(?:-|$)/.test(section ?? '')) section = 'run-explanation'
  }
  if (experiment.id === 'spatial-grid') {
    if (section === 'case-comparison') section = 'run-explanation'
    if (section === 'run-more-settings') section = 'run-configuration'
    if (section === 'run-diagnostics') section = 'grid-benchmark'
  }
  if (experiment.id === 'point-rendering' && /^doc-(?:overview|limitations)(?:-|$)/.test(section ?? '')) section = 'doc-case-method'
  if (experiment.id === 'point-shapes' && section === 'run-results') section = 'doc-automated-cases'
  if (experiment.id === 'point-shapes' && section === 'run-more-settings') section = 'run-configuration'
  if (experiment.id === 'selection' && /^doc-selection(?:-|$)/.test(section ?? '')) section = null
  const page = evidencePageAt(experiment, section ?? '')
  if (section?.startsWith('doc-agent-recipe') || (page && !isReaderPage(experiment, page))) {
    section = 'recorded-findings'
  }
  if (!experiment.create && section) {
    const archivedCase = experiment.cases!.find(item => section === liveCaseSection(item))
    if (archivedCase) section = findingSection(archivedCase)
    else if (section === 'case-live' || section.startsWith('run-')) section = 'recorded-findings'
  }

  const selectorCase = experiment.cases!.find(item => item.kind !== 'recorded' && section === liveCaseSection(item))
  const liveCase = selectorCase ?? (!section && experiment.presentation === 'demo' ? startingCase(experiment) : undefined)
  const href = experimentSectionHref(experiment.id, section)
  if (selectorCase) section = experiment.presentation === 'demo' ? null : 'case-live'
  return { href, liveCase, section }
}
