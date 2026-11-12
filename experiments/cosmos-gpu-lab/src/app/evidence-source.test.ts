import { afterEach, expect, it } from 'vitest'
import { disposeDocumentTables } from '../runtime/result-tables'
import { readEvidenceSource } from './evidence-source'
import { renderMarkdown } from './markdown'

let host: HTMLElement | undefined
afterEach(() => { if (host) { disposeDocumentTables(host); host.remove() } })

it('keeps missing measurement dates unknown and renders provenance as plain text', async () => {
  host = document.createElement('div'); document.body.append(host)
  await renderMarkdown(host, `---
source: Recorded findings
device: <img src=x onerror=alert(1)>
scope: Frozen fixture only
---

# Captured experiment

Original measurements stay visible.`, {}, { linkTerms: false })
  expect(host.querySelector('.evidence-source')!.textContent).toContain('Not recorded')
  expect(host.querySelector('.evidence-source')!.textContent).toContain('<img src=x')
  expect(host.querySelector('img')).toBeNull()
  expect(host.textContent).toContain('Original measurements stay visible.')
  expect(host.querySelector('h1')!.nextElementSibling).toBe(host.querySelector('.evidence-source'))
})

it('validates explicit metadata without treating ordinary markdown as metadata', () => {
  const plain = '# Method\n\n---\n\nReference'
  expect(readEvidenceSource(plain)).toEqual({ body: plain })
  expect(() => readEvidenceSource('---\nsource: Recorded findings\nrecorded: 2026-11-05\n---\n')).toThrow('scope')
})

it('parses every authored evidence source and keeps a nonempty article body', () => {
  const articles = import.meta.glob<string>('../experiments/**/*.md', { eager: true, query: '?raw', import: 'default' })
  let count = 0
  for (const source of Object.values(articles)) {
    const { body, evidence } = readEvidenceSource(source)
    if (!evidence) continue
    count++; expect(evidence.scope.length).toBeGreaterThan(20); expect(body.trim().length).toBeGreaterThan(100)
  }
  expect(count).toBeGreaterThan(40)
})
