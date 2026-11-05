export type AppRoute =
  | { kind: 'home' }
  | { kind: 'vocabulary' }
  | { kind: 'experiment'; experimentId: string; pageId?: string }

export function readRoute (): AppRoute {
  const segments = window.location.hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)

  if (segments.length === 0) return { kind: 'home' }
  if (segments[0] === 'vocabulary') return { kind: 'vocabulary' }

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

export function experimentHref (experimentId: string, pageId?: string): string {
  const root = `#/${encodeURIComponent(experimentId)}`
  return pageId ? `${root}/docs/${encodeURIComponent(pageId)}` : root
}
