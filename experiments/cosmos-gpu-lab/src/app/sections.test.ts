import { afterEach, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'
import { currentSection } from './router'
import { scrollToSection } from './sections'
let host: HTMLElement | undefined
const original = window.location.href
afterEach(() => { host?.remove(); window.history.replaceState(null, '', original) })

it('creates stable duplicate-safe section links while preserving the document route', async () => {
  window.history.replaceState(null, '', '#/architecture')
  host = document.createElement('div'); document.body.append(host)
  await renderMarkdown(host, '## Conclusion\n\n## Scope\n\n## Evidence\n\n## Evidence\n\n[Jump](#scope)', {}, { linkTerms: false })
  expect(Array.from(host.querySelectorAll('h2'), h => h.id)).toEqual(['conclusion', 'scope', 'evidence', 'evidence-2'])
  expect(host.querySelector('nav[aria-label="On this page"]')).not.toBeNull()
  expect(host.querySelector('.document-contents')!.closest('details')).toBeNull()
  expect(host.querySelector('.document-layout')!.firstElementChild!.className).toBe('document-contents')
  expect(host.querySelector('a.section-permalink')?.getAttribute('href')).toBe('#/architecture?section=conclusion')
  expect(Array.from(host.querySelectorAll('a')).find(link => link.textContent === 'Jump')?.getAttribute('href'))
    .toBe('#/architecture?section=scope')
  window.history.replaceState(null, '', '#/architecture?section=evidence-2')
  expect(scrollToSection(host, currentSection())).toBe(true); expect(document.activeElement?.id).toBe('evidence-2')
  expect(scrollToSection(host, 'missing')).toBe(false)
})

it('does not add a second contents system to guides with their own navigation', async () => {
  host = document.createElement('div')
  await renderMarkdown(host, '## One\n\n## Two\n\n## Three\n\n## Four', {}, { sectionNavigation: false })
  expect(host.querySelector('.document-contents,.section-permalink')).toBeNull()
})
