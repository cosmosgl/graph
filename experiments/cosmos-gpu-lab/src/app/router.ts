export type AppRoute =
  | { kind: 'home' }
  | { kind: 'architecture' }
  | { kind: 'learn'; sectionId?: string }
  | { kind: 'roadmap' }
  | { kind: 'feature-inventory' }
  | { kind: 'vocabulary'; termId?: string }
  | { kind: 'concept'; conceptId: string }
  | { kind: 'experiment'; experimentId: string; pageId?: string }

export function readRoute (): AppRoute {
  const segments = window.location.hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)

  if (segments.length === 0) return { kind: 'home' }
  if (segments[0] === 'learn') return { kind: 'learn', sectionId: segments[1] }
  if (segments[0] === 'roadmap') return { kind: 'roadmap' }
  if (segments[0] === 'feature-inventory') return { kind: 'feature-inventory' }
  if (segments[0] === 'architecture') return { kind: 'architecture' }
  if (segments[0] === 'vocabulary') {
    return {
      kind: 'vocabulary',
      termId: segments[1] ? decodeURIComponent(segments[1]) : undefined,
    }
  }
  if (segments[0] === 'concepts' && segments[1]) {
    return { kind: 'concept', conceptId: decodeURIComponent(segments[1]) }
  }

  return {
    kind: 'experiment',
    experimentId: decodeURIComponent(segments[0]),
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

export function experimentHref (experimentId: string, pageId?: string): string {
  const root = `#/${encodeURIComponent(experimentId)}`
  return pageId ? `${root}/docs/${encodeURIComponent(pageId)}` : root
}

export function roadmapHref (): string {
  return '#/roadmap'
}

export function featureInventoryHref (): string {
  return '#/feature-inventory'
}
