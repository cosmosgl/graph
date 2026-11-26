export function headingSlug (text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section'
}

export function scrollToSection (host: HTMLElement, section: string | null): boolean {
  if (!section) return false
  const target = Array.from(host.querySelectorAll<HTMLElement>('[id]')).find(element => element.id === section)
  if (!target) return false
  target.scrollIntoView({ block: 'start' }); target.tabIndex = -1; target.focus({ preventScroll: true })
  return true
}

export function addSectionNavigation (host: HTMLElement, includeContents = true): void {
  const article = host.querySelector<HTMLElement>('.prose')
  if (!article) return
  const base = window.location.hash.split('?')[0] || '#/'
  const href = (id: string): string => `${base}?section=${encodeURIComponent(id)}`
  const used = new Set(Array.from(article.querySelectorAll<HTMLElement>('[id]'), node => node.id))
  const headings = Array.from(article.querySelectorAll<HTMLElement>('h2,h3'))
  const labels = new Map<HTMLElement, string>()
  for (const heading of headings) {
    const label = heading.textContent!.trim(); labels.set(heading, label)
    if (!heading.id) {
      const stem = headingSlug(label); let id = stem; let duplicate = 2
      while (used.has(id)) id = `${stem}-${duplicate++}`
      heading.id = id; used.add(id)
    }
    const link = document.createElement('a'); link.href = href(heading.id); link.className = 'section-permalink'
    link.setAttribute('aria-label', `Link to section: ${label}`); link.textContent = '#'; heading.append(link)
  }
  // Author-written local section links must retain the app route too.
  for (const link of article.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const value = link.getAttribute('href')!
    if (!value.startsWith('#/') && value.length > 1) link.href = href(decodeURIComponent(value.slice(1)))
  }
  if (!includeContents || headings.length < 4) return
  const layout = document.createElement('div'); layout.className = 'document-layout'
  article.before(layout); layout.append(article)
  const contents = document.createElement('nav'); contents.className = 'document-contents'
  contents.setAttribute('aria-label', 'On this page')
  const title = document.createElement('p'); title.textContent = 'On this page'; contents.append(title)
  const list = document.createElement('ul')
  // Keep the visible contents short; subsection headings still have their own permalinks.
  const topLevel = headings.filter(heading => heading.tagName === 'H2')
  for (const heading of topLevel.length ? topLevel : headings) {
    const item = document.createElement('li')
    const link = document.createElement('a'); link.href = href(heading.id); link.textContent = labels.get(heading)!
    item.append(link); list.append(item)
  }
  contents.append(list); layout.prepend(contents)
}
