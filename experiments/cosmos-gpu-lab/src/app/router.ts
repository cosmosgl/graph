export type AppRoute =
  | { kind: 'home' }
  | { kind: 'architecture' }
  | { kind: 'learn'; sectionId?: string }
  | { kind: 'roadmap' }
  | { kind: 'feature-inventory' }
  | { kind: 'validation-workflow' }
  | { kind: 'numerical-research' }
  | { kind: 'vocabulary'; termId?: string }
  | { kind: 'concept'; conceptId: string }
  | { kind: 'experiment'; experimentId: string; pageId?: string; view?: 'run' | 'evidence' }

export function currentSection (): string | null {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('section')
}

export function readRoute (): AppRoute {
  const segments = window.location.hash
    .split('?')[0]
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)

  if (segments.length === 0) return { kind: 'home' }
  if (segments[0] === 'learn') return { kind: 'learn', sectionId: segments[1] }
  if (segments[0] === 'roadmap') return { kind: 'roadmap' }
  if (segments[0] === 'feature-inventory') return { kind: 'feature-inventory' }
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
  return {
    kind: 'experiment',
    experimentId: decodeURIComponent(segments[0]),
    // Retain the old Run/Evidence routes and in-page Run bookmarks as aliases.
    view: segments[1] === 'run' || (segments.length === 1 && legacyRun)
      ? 'run'
      : segments[1] === 'evidence' ? 'evidence' : undefined,
    pageId: segments[1] === 'docs' && segments[2]
      ? decodeURIComponent(segments[2])
      : undefined,
  }
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

export function articleSectionId (pageId: string, section?: string): string {
  return `doc-${pageId}${section ? `-${section}` : ''}`
}

export function experimentHref (experimentId: string, pageId?: string, section?: string): string {
  const root = `#/${encodeURIComponent(experimentId)}`
  return pageId ? `${root}?section=${encodeURIComponent(articleSectionId(pageId, section))}` : root
}

export function runHref (experimentId: string): string {
  return experimentHref(experimentId)
}

export function roadmapHref (): string {
  return '#/roadmap'
}

export function featureInventoryHref (): string {
  return '#/feature-inventory'
}
