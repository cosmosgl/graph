import { cases as pointStylingCases, pointStylingExperimentIds } from '../experiments/point-styling/cases'

type ExperimentRoute = {
  kind: 'experiment';
  experimentId: string;
  pageId?: string;
  caseId?: string;
  evidencePage?: string;
  view?: 'run' | 'evidence';
}

export type AppRoute =
  | { kind: 'home' }
  | { kind: 'architecture' }
  | { kind: 'learn'; sectionId?: string }
  | { kind: 'roadmap'; section?: string }
  | { kind: 'validation-workflow' }
  | { kind: 'numerical-research' }
  | { kind: 'vocabulary'; termId?: string }
  | { kind: 'concept'; conceptId: string }
  | ExperimentRoute

export function currentSection (): string | null {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('section')
}

export function articleSectionId (pageId: string, section?: string): string {
  return `doc-${pageId}${section ? `-${section}` : ''}`
}

// Keep bookmarks and search results from both former documents useful.
const migrationSectionAliases = new Map([
  ['1-simulation-forces', 'coverage-simulation'],
  ['2-point-rendering', 'coverage-points'],
  ['3-link-rendering', 'coverage-links'],
  ['4-rendering-support-and-interaction', 'coverage-interaction'],
  ['5-what-the-existing-experiments-actually-establish', 'feature-coverage'],
  ['keeping-this-checklist-useful', 'how-to-read-coverage'],
  ['1-where-we-are', 'current-focus'],
  ['million-point-four-corners-on-m3', 'current-focus'],
  ['persistent-dense-communities-on-m3', 'current-focus'],
  ['drawing-and-interaction-on-the-m3', 'current-focus'],
  ['million-point-moving-graph', 'current-focus'],
  ['first-integrated-migration-bounded-pilot-evaluated', 'migration-status'],
  ['production-blockers', 'what-remains'],
  ['open-milestone-checklists', 'what-remains'],
  ['cross-cutting-work-still-open', 'what-remains'],
  ['gpu-execution-and-resources', 'what-remains'],
  ['simulation', 'coverage-simulation'],
  ['rendering-and-interaction', 'feature-coverage'],
  ['library-and-embedding', 'feature-host-rendering-and-shared-resources'],
  ['production-acceptance', 'what-remains'],
  ['milestone-execution', 'what-remains'],
  ['milestone-simulation', 'coverage-simulation'],
  ['milestone-rendering', 'feature-coverage'],
  ['milestone-integration', 'feature-host-rendering-and-shared-resources'],
  ['milestone-production', 'what-remains'],
  ['2-current-numerical-and-layout-boundary', 'coverage-simulation'],
  ['core-composed-simulation', 'coverage-simulation'],
  ['center-and-collision', 'feature-collision'],
  ['3-the-ordered-research-plan', 'current-focus'],
  ['recommended-next-work', 'current-focus'],
  ['journey-polygon-boundaries', 'feature-other-shapes'],
  ['journey-graph-integration', 'migration-status'],
  ['journey-missing-forces', 'coverage-simulation'],
  ['journey-link-rendering', 'coverage-links'],
  ['journey-production-envelope', 'current-focus'],
  ['retained-rendering-evidence', 'parked-investigations'],
  ['4-luma-decisions-still-open', 'what-remains'],
  ['5-evidence-to-retain-and-its-limits', 'feature-coverage'],
  ['6-the-migration-journey', 'what-remains'],
  ['7-future-directions', 'future-directions'],
])

// Preserve bookmarks to cases moved to their own pages and keep existing evidence links.
export function resolveExperimentAliases (route: ExperimentRoute, section: string | null): ExperimentRoute {
  if (route.experimentId === 'viewer-comparison' &&
    (route.caseId === 'dense-communities' || section === 'try-dense-communities' || section === 'finding-dense-communities')) {
    if (route.pageId || route.evidencePage || section?.startsWith('doc-')) return { ...route, caseId: undefined }
    return { ...route, experimentId: 'dense-communities' }
  }

  if (route.experimentId !== 'point-styling') return route
  const namedCase = pointStylingCases.find(item => item.id === route.caseId)
  if (route.caseId && !namedCase) return route

  const explicitPage = route.evidencePage ?? route.pageId
  const docSection = section?.startsWith('doc-') ? section : ''
  const evidenceCase = pointStylingCases.find(item => {
    const page = item.recorded.evidence[0].page
    const prefix = articleSectionId(page)
    return explicitPage ? explicitPage === page : docSection === prefix || docSection.startsWith(`${prefix}-`)
  })
  const selectedCase = pointStylingCases.find(item => section === `try-${item.id}` || section === `finding-${item.id}`)
  const contractSection = articleSectionId('validation-contract')
  const sharedDocument = explicitPage
    ? explicitPage !== 'validation-contract'
    : docSection !== '' && docSection !== contractSection && !docSection.startsWith(`${contractSection}-`)
  const defaultCase = section === 'run-diagnostics' ? 'picking' : 'shapes'
  const liveCase = sharedDocument ? 'shapes' : selectedCase?.id ?? namedCase?.id ?? defaultCase
  return { ...route, experimentId: pointStylingExperimentIds[evidenceCase?.id ?? liveCase], caseId: undefined }
}

export function readRoute (): AppRoute {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const segments = window.location.hash
    .split('?')[0]
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)

  if (segments.length === 0) return { kind: 'home' }
  if (segments[0] === 'learn') return { kind: 'learn', sectionId: segments[1] }
  if (segments[0] === 'roadmap' || segments[0] === 'feature-inventory') {
    const section = params.get('section') || (segments[0] === 'feature-inventory' ? 'feature-coverage' : undefined)
    return { kind: 'roadmap', section: section && (migrationSectionAliases.get(section) ?? section) }
  }
  if (segments[0] === 'architecture') return { kind: 'architecture' }
  if (segments[0] === 'validation-workflow') return { kind: 'validation-workflow' }
  if (segments[0] === 'numerical-research') return { kind: 'numerical-research' }
  if (segments[0] === 'vocabulary') {
    return {
      kind: 'vocabulary',
      termId: segments[1] ? decodeURIComponent(segments[1]) : undefined,
    }
  }
  if (segments[0] === 'concepts' && segments[1]) {
    return { kind: 'concept', conceptId: decodeURIComponent(segments[1]) }
  }

  const legacyRun = currentSection()?.startsWith('run-') || (segments[0] === 'weighted-links' &&
    ['WebGL', 'WebGPU'].includes(new URLSearchParams(window.location.search).get('linkDiagnostic') ?? ''))
  return resolveExperimentAliases({
    kind: 'experiment',
    experimentId: decodeURIComponent(segments[0]),
    caseId: params.get('case') ?? undefined,
    evidencePage: params.get('evidence') ?? undefined,
    // Retain the old Run/Evidence routes and in-page Run bookmarks as aliases.
    view: segments[1] === 'run' || (segments.length === 1 && legacyRun)
      ? 'run'
      : segments[1] === 'evidence' ? 'evidence' : undefined,
    pageId: segments[1] === 'docs' && segments[2]
      ? decodeURIComponent(segments[2])
      : undefined,
  }, currentSection())
}

export function vocabularyHref (): string {
  return '#/vocabulary'
}

export function architectureHref (): string {
  return '#/architecture'
}

export function conceptHref (conceptId: string): string {
  return `#/concepts/${encodeURIComponent(conceptId)}`
}

export function experimentHref (experimentId: string, pageId?: string, section?: string): string {
  const root = `#/${encodeURIComponent(experimentId)}`
  return pageId ? `${root}?section=${encodeURIComponent(articleSectionId(pageId, section))}` : root
}

export function experimentSectionHref (experimentId: string, section?: string | null): string {
  return section ? `${experimentHref(experimentId)}?section=${encodeURIComponent(section)}` : experimentHref(experimentId)
}

export function caseHref (experimentId: string, caseId: string, section?: string): string {
  const params = new URLSearchParams({ case: caseId })
  if (section) params.set('section', section)
  return `${experimentHref(experimentId)}?${params}`
}

export function caseEvidenceHref (experimentId: string, caseId: string, pageId: string, section?: string): string {
  const params = new URLSearchParams({ case: caseId, evidence: pageId })
  if (section) params.set('section', articleSectionId(pageId, section))
  return `${experimentHref(experimentId)}?${params}`
}

export function runHref (experimentId: string): string {
  return experimentHref(experimentId)
}

export function roadmapHref (section?: string): string {
  return section ? `#/roadmap?section=${encodeURIComponent(section)}` : '#/roadmap'
}
