import type { ExperimentCase, ExperimentDefinition, ExperimentPage } from '../runtime/experiment'
import { caseEvidenceLinks } from '../runtime/experiment'
import type { AppRoute } from './router'
import { articleSectionId, caseHref, experimentSectionHref } from './router'

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
  if (!section.startsWith('doc-')) return undefined
  return experiment.pages.filter(page => {
    const prefix = articleSectionId(page.id)
    return section === prefix || section.startsWith(`${prefix}-`)
  }).sort((left, right) => right.id.length - left.id.length)[0]
}

export function isReaderPage (experiment: ExperimentDefinition, page: ExperimentPage): boolean {
  return page.id !== experiment.study?.recipePage && !/\bagents?\b|\b(?:replay|reproduction) instructions\b/i.test(`${page.id} ${page.title}`)
}

export function caseEvidencePages (experiment: ExperimentDefinition): ExperimentPage[] {
  const ids = new Set(experiment.cases!.flatMap(item => caseEvidenceLinks(item).map(link => link.page)))
  return experiment.pages.filter(page => ids.has(page.id) && !Object.hasOwn(experiment.singlePage?.pageSections ?? {}, page.id) &&
    isReaderPage(experiment, page))
}

type ExperimentRoute = Extract<AppRoute, { kind: 'experiment' }>
export type ExperimentDestination = { href: string; section: string | null; startLive: boolean; liveCase?: ExperimentCase }

export function experimentDestination (
  experiment: ExperimentDefinition, route: ExperimentRoute, requested: string | null
): ExperimentDestination | undefined {
  const first = startingCase(experiment)
  const namedCase = experiment.cases!.find(item => item.id === route.caseId)
  const aliases = experiment.singlePage?.legacyCases ?? {}
  const legacy = route.caseId && Object.hasOwn(aliases, route.caseId) ? aliases[route.caseId] : undefined
  if (route.caseId && !namedCase && !legacy) return undefined

  let section = requested
  const explicitPage = route.evidencePage ?? route.pageId
  const page = explicitPage ? experiment.pages.find(item => item.id === explicitPage) : evidencePageAt(experiment, section ?? '')
  if (explicitPage && !page && explicitPage !== 'agent-recipe') return undefined
  if (explicitPage === 'agent-recipe' || section?.startsWith('doc-agent-recipe') || (page && !isReaderPage(experiment, page))) {
    section = 'recorded-findings'
  } else if (page) {
    const mapped = experiment.singlePage?.pageSections[page.id]
    const prefix = articleSectionId(page.id)
    const scoped = section === prefix || section?.startsWith(`${prefix}-`)
    section = mapped ?? (scoped ? section : articleSectionId(page.id, section ?? undefined))
  } else if (legacy) section = legacy
  else if ((route.view === 'evidence' && !section) || section === 'study-overview' || section === 'study-investigations' || section === 'recorded-findings') {
    section = namedCase && namedCase !== first && !experiment.singlePage ? findingSection(namedCase) : 'recorded-findings'
  } else if (namedCase?.kind === 'recorded' && namedCase !== first) section = findingSection(namedCase)
  else if (!section && namedCase && namedCase !== first) section = liveCaseSection(namedCase)

  const selectorCase = experiment.cases!.find(item => item.kind !== 'recorded' && section === liveCaseSection(item))
  const runAnchor = section?.startsWith('run-') || section === 'case-live'
  let liveCase = selectorCase
  if ((!section || runAnchor) && namedCase?.kind !== 'recorded' && namedCase) liveCase = namedCase
  const startLive = first.kind !== 'recorded' && (!section || !!runAnchor || !!selectorCase)
  const href = runAnchor && liveCase && liveCase !== first
    ? caseHref(experiment.id, liveCase.id, section ?? undefined)
    : experimentSectionHref(experiment.id, section)
  return { href, liveCase, startLive, section: selectorCase || section === 'run-run' ? 'case-live' : section }
}
