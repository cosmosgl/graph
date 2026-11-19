import type { CaseReadiness } from './readiness/types'
import { readinessBadge } from './readiness/presentation'

export function experimentMiniCard (title: string, href: string, readiness?: CaseReadiness): HTMLAnchorElement {
  const link = document.createElement('a')
  link.className = 'case-nav-link'
  link.href = href
  const name = document.createElement('span')
  name.className = 'case-nav-title'
  name.textContent = title
  link.append(name, readinessBadge(readiness?.badge ?? 'Not assessed', readiness?.tone ?? 'neutral'))
  return link
}
