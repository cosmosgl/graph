import type { ExperimentDefinition } from '../runtime/experiment'
import type { ResearchSummary } from './research'
import { articleSectionId, experimentHref } from './router'
import { headingSlug } from './sections'

export function addArticleSections (host: HTMLElement, experimentId: string, pageId: string): void {
  const headings = Array.from(host.querySelectorAll<HTMLElement>('[data-heading-level]'))
  const used = new Set<string>()
  // The former article pages assigned slugs to h2/h3 only. Assign those first
  // so their existing deep links survive repeated titles and deeper headings.
  const legacy = headings.filter(h => h.dataset.headingLevel === '2' || h.dataset.headingLevel === '3')
  for (const heading of [...legacy, ...headings.filter(h => !legacy.includes(h))]) {
    const label = heading.textContent!.trim(); heading.dataset.sectionLabel = label
    const stem = heading.dataset.headingLevel === '1' ? 'title' : headingSlug(label)
    let slug = stem; let suffix = 2
    while (used.has(slug)) slug = `${stem}-${suffix++}`
    used.add(slug); heading.id = articleSectionId(pageId, slug)
    const link = document.createElement('a'); link.className = 'section-permalink'
    link.href = experimentHref(experimentId, pageId, slug); link.textContent = '#'
    link.setAttribute('aria-label', `Link to section: ${label}`); heading.append(link)
  }
  for (const link of host.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const value = link.getAttribute('href')!
    if (!value.startsWith('#/') && value.length > 1) link.href = experimentHref(experimentId, pageId, decodeURIComponent(value.slice(1)))
  }
}

export function resolveExperimentSection (host: HTMLElement, record: ResearchSummary, section: string | null): string | null {
  if (!section || host.querySelector(`[id="${CSS.escape(section)}"]`)) return section
  // The primary method formerly appended the shared contract. Its old anchors
  // now point to the single comparison contract, rather than duplicated prose.
  const prefix = `${articleSectionId(record.method)}-`
  if (section.startsWith(prefix)) {
    const field = section.slice(prefix.length).replace(/-\d+$/, '')
    if (['question', 'reference', 'acceptance', 'checked-population', 'limits'].includes(field)) return articleSectionId('validation-contract', field)
  }
  return section
}

export function rewriteArticleLinks (host: HTMLElement, experiment: ExperimentDefinition, record: ResearchSummary): void {
  for (const link of host.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const url = new URL(link.href)
    if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) continue
    const match = /^#\/([^/?]+)\/docs\/([^/?]+)(?:\?(.*))?$/.exec(url.hash)
    if (match) {
      const id = decodeURIComponent(match[1]); const page = decodeURIComponent(match[2])
      const section = new URLSearchParams(match[3]).get('section') ?? undefined
      link.href = experimentHref(id, page, section)
    }
    const canonical = new URL(link.href)
    if (canonical.hash.split('?')[0] !== experimentHref(experiment.id)) continue
    const params = new URLSearchParams(canonical.hash.split('?')[1])
    if (params.get('section')?.startsWith('doc-agent-recipe')) {
      params.set('section', 'recorded-findings'); link.href = `${experimentHref(experiment.id)}?${params}`
      link.textContent = 'recorded findings'
      continue
    }
    const section = resolveExperimentSection(host, record, params.get('section'))
    if (section) { params.set('section', section); link.href = `${experimentHref(experiment.id)}?${params}` }
  }
}
