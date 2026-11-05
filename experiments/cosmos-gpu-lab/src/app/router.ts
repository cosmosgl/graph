export type AppRoute =
  | { kind: 'home' }
  | { kind: 'experiment'; experimentId: string; pageId?: string }

export function readRoute (): AppRoute {
  const segments = window.location.hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)

  if (segments.length === 0) return { kind: 'home' }

  return {
    kind: 'experiment',
    experimentId: decodeURIComponent(segments[0]),
    pageId: segments[1] === 'docs' && segments[2]
      ? decodeURIComponent(segments[2])
      : undefined,
  }
}

export function experimentHref (experimentId: string, pageId?: string): string {
  const root = `#/${encodeURIComponent(experimentId)}`
  return pageId ? `${root}/docs/${encodeURIComponent(pageId)}` : root
}
