import { articleSectionId, experimentHref } from './router'
import { headingSlug } from './sections'

export function addArticleSections (host: HTMLElement, experimentId: string, pageId: string): void {
  const headings = Array.from(host.querySelectorAll<HTMLElement>('[data-heading-level]'))
  const used = new Set<string>()
  // Assign level-two and level-three headings first, matching the search index.
  const sectionHeadings = headings.filter(h => h.dataset.headingLevel === '2' || h.dataset.headingLevel === '3')
  for (const heading of [...sectionHeadings, ...headings.filter(h => !sectionHeadings.includes(h))]) {
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
