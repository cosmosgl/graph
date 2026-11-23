export type AppRoute =
  | { kind: 'home' }
  | { kind: 'architecture' }
  | { kind: 'learn'; sectionId?: string }
  | { kind: 'roadmap'; section?: string }
  | { kind: 'validation-workflow' }
  | { kind: 'numerical-research' }
  | { kind: 'vocabulary'; termId?: string }
  | { kind: 'concept'; conceptId: string }
  | { kind: 'experiment'; experimentId: string }

export function currentSection (): string | null {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('section')
}

export function articleSectionId (pageId: string, section?: string): string {
  return `doc-${pageId}${section ? `-${section}` : ''}`
}

export function readRoute (): AppRoute {
  const segments = window.location.hash
    .split('?')[0]
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)

  if (segments.length === 0) return { kind: 'home' }
  if (segments[0] === 'learn') return { kind: 'learn', sectionId: segments[1] }
  if (segments[0] === 'roadmap') return { kind: 'roadmap', section: currentSection() ?? undefined }
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

  const experimentId = decodeURIComponent(segments.join('/'))
  if (experimentId === 'integrated-webgpu' && ['run-results', 'run-diagnostics'].includes(currentSection() ?? '')) {
    return { kind: 'experiment', experimentId: 'integrated-webgpu-benchmarks' }
  }
  // Preserve bookmarks to the selection case and its evidence from before the split.
  if (experimentId === 'integrated-webgpu' && /^(?:(?:try|finding)-shape-selection$|doc-selection(?:-|$))/.test(currentSection() ?? '')) {
    return { kind: 'experiment', experimentId: 'selection' }
  }
  return { kind: 'experiment', experimentId }
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

export function roadmapHref (section?: string): string {
  return section ? `#/roadmap?section=${encodeURIComponent(section)}` : '#/roadmap'
}
