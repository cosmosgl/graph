import { expect, it } from 'vitest'
import { buildSearchIndex, indexMarkdown, searchIndex } from './search-index'

it('indexes published experiments, evidence, guides and feature coverage with direct links', async () => {
  const index = await buildSearchIndex()
  expect(index.unavailable).toBe(0)
  const gravity = searchIndex(index, 'gravity')
  expect(gravity.some(result => result.href === '#/precision-diagnostics?case=gravity-accuracy' && result.kind === 'Experiment')).toBe(true)
  expect(gravity.some(result => result.href.startsWith('#/precision-diagnostics?case=gravity-accuracy&evidence=gravity-evidence'))).toBe(true)
  expect(gravity.some(result => result.href === '#/feature-inventory?section=feature-gravity')).toBe(true)
  const storedAlpha = searchIndex(index, 'stored alpha')
  expect(storedAlpha[0]?.href).toBe('#/point-styling?case=picking&section=recorded-findings')
  expect(storedAlpha.some(result => result.href.startsWith('#/point-styling?case=picking&evidence=picking-evidence'))).toBe(true)
  expect(searchIndex(index, 'ping pong buffers').some(result => result.href === '#/learn/8')).toBe(true)
  expect(searchIndex(index, 'prefix sum').some(result => result.href === '#/vocabulary/scan')).toBe(true)
  expect(searchIndex(index, 'dense requests expensive').some(result => result.href === '#/point-styling?case=picking')).toBe(true)
  const center = searchIndex(index, '4.802 ms')
  expect(center.some(result => result.href === '#/center-mass?case=center-comparison&section=center-force-cost')).toBe(true)
  expect(index.entries.some(result => result.experimentId === 'center-mass' && result.href.includes('evidence='))).toBe(false)
  expect(index.entries.some(result => /agent[-_ ]recipe/i.test(`${result.title} ${result.context} ${result.heading} ${result.text}`))).toBe(false)
  expect(searchIndex(index, 'agent recipe')).toHaveLength(0)
})

it('omits agent and reproduction instructions and links ordinary evidence to its heading', () => {
  const entries = indexMarkdown(`# Evidence

## A finding

The result is visible.

## Instructions for agents

Secret instruction not for readers.

### Nested instruction

Another secret instruction.

## Reproduce

Run pnpm and save a secret capture.

## Another finding

The retained failure is important.

| Run | Measured | Local capture under \`captures/\` | Source archive SHA-256 |
| --- | --- | --- | --- |
| Control | 12 ms | \`private-run/\` | \`abcd1234\` |

\`\`\`sh
pnpm secret-command
\`\`\`

Use the [agent recipe](#/test/docs/agent-recipe) to replay.
`, {
    key: 'test',
    title: 'Evidence',
    kind: 'Evidence',
    context: '',
    baseHref: '#/test?section=doc-findings',
    mode: 'article',
    experimentId: 'test',
    pageId: 'findings',
  })
  const combined = entries.map(item => `${item.heading} ${item.text}`).join(' ')
  expect(combined).toContain('The retained failure is important.')
  expect(combined).toContain('12 ms')
  expect(combined).not.toContain('Secret instruction')
  expect(combined).not.toContain('secret-command')
  expect(combined).not.toContain('agent recipe')
  expect(combined).not.toContain('private-run')
  expect(combined).not.toContain('abcd1234')
  expect(entries.find(item => item.heading === 'Another finding')?.href).toBe('#/test?section=doc-findings-another-finding')
})
