import { expect, it } from 'vitest'
import { addArticleSections, resolveExperimentSection, rewriteArticleLinks } from './article-sections'
import { renderMarkdown } from './markdown'
import { findExperiment } from './registry'
import { research } from './research'

it('preserves legacy duplicate heading slugs and scopes local links to their article', async () => {
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

it('maps old method contract links to the single contract without replacing an actual source section', () => {
  const host = document.createElement('div')
  host.innerHTML = '<div id="doc-validation-contract-reference"></div>'
  expect(resolveExperimentSection(host, research['center-mass'], 'doc-overview-reference')).toBe('doc-validation-contract-reference')
  host.innerHTML += '<div id="doc-overview-reference"></div>'
  expect(resolveExperimentSection(host, research['center-mass'], 'doc-overview-reference')).toBe('doc-overview-reference')
})

it('rewrites article URLs to section links and preserves shared reference destinations', () => {
  const host = document.createElement('div')
  host.innerHTML = `<a href="#/center-mass/docs/algorithm?section=webgpu-reduction">Algorithm</a>
    <a href="#/center-mass/docs/overview?section=reference">Contract</a><a href="#/vocabulary/ulp">ULP</a>`
  rewriteArticleLinks(host, findExperiment('center-mass')!, research['center-mass'])
  expect(Array.from(host.querySelectorAll('a'), link => link.getAttribute('href'))).toEqual([
    '#/center-mass?section=doc-algorithm-webgpu-reduction', '#/center-mass?section=doc-validation-contract-reference', '#/vocabulary/ulp',
  ])
})
