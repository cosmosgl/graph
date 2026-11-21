import { expect, it } from 'vitest'
import { addArticleSections } from './article-sections'
import { renderMarkdown } from './markdown'

it('gives repeated headings distinct section links and keeps local links in their article', async () => {
  const host = document.createElement('div')
  await renderMarkdown(host, '# Title\n\n## Scope\n\n### Scope\n\n#### Scope\n\n## Scope\n\n[Jump](#scope-2)', {}, {
    headingLevelOffset: 2, sectionNavigation: false, linkTerms: false, tables: false,
  })
  addArticleSections(host, 'center-mass', 'algorithm')
  expect(Array.from(host.querySelectorAll('[data-heading-level]'), node => node.id)).toEqual([
    'doc-algorithm-title', 'doc-algorithm-scope', 'doc-algorithm-scope-2', 'doc-algorithm-scope-4', 'doc-algorithm-scope-3',
  ])
  expect(Array.from(host.querySelectorAll('a')).find(link => link.textContent === 'Jump')?.getAttribute('href'))
    .toBe('#/center-mass?section=doc-algorithm-scope-2')
  expect(host.querySelector('nav')).toBeNull()
})
