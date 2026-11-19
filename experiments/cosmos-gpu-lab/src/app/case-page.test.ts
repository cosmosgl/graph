import { expect, it } from 'vitest'
import { findExperiment } from './registry'
import { renderCaseEvidence, renderCaseFrame } from './case-page'

it('keeps findings and provenance readable while leaving replay instructions in the source', async () => {
  const experiment = findExperiment('center-mass')!
  const host = document.createElement('div'); document.body.append(host)
  try {
    await renderCaseEvidence(host, experiment, experiment.cases![0], {
      kind: 'markdown',
      id: 'example',
      title: 'Evidence',
      load: async () => `# Evidence

## Historical failure

The earlier strict check failed.

## Reproduce the check

1. Run the agent-only replay.

## Source and reproduction

The observation used the recorded M3 session.

The first measured control passed. Follow [the recipe](#/center-mass?section=doc-agent-recipe) to reproduce it. A later control failed.

The capture is in \`captures/private-run/\`. The reported finding is bounded.

| Run | Measured | Local capture under \`captures/\` | Source archive SHA-256 |
| --- | --- | --- | --- |
| Control | 12 ms | \`private-run/\` | \`abcd1234\` |

## Later finding

The original failure remains relevant.`,
    })
    expect(host.textContent).toContain('The earlier strict check failed.')
    expect(host.textContent).toContain('The observation used the recorded M3 session.')
    expect(host.textContent).toContain('The original failure remains relevant.')
    expect(host.textContent).toContain('The first measured control passed.')
    expect(host.textContent).toContain('A later control failed.')
    expect(host.textContent).toContain('The reported finding is bounded.')
    expect(host.textContent).toContain('12 ms')
    expect(host.textContent).not.toContain('Run the agent-only replay.')
    expect(host.textContent).not.toContain('Follow the recipe')
    expect(host.textContent).not.toContain('captures/private-run')
    expect(host.textContent).not.toContain('abcd1234')
    expect(host.querySelector('#doc-example-historical-failure')).not.toBeNull()
    expect(host.querySelector('#doc-example-source-and-reproduction')).not.toBeNull()
  } finally { host.remove() }
})

it('keeps a method available without inventing a finding and shows the experiment group', () => {
  const source = findExperiment('point-rendering')!
  const item = {
    id: 'comparison',
    title: 'Compare points',
    kind: 'compare' as const,
    question: 'How do the points compare?',
    description: 'Draw the same points.',
    tryIt: 'Compare the views.',
    reference: 'The same inputs.',
    acceptance: 'Read the displayed difference.',
    recorded: null,
    evidence: [{ label: 'How it works', page: source.pages[0].id }],
  }
  const experiment = { ...source, cases: [item] }
  const host = document.createElement('div')
  renderCaseFrame(host, experiment, item)
  expect(host.querySelector('.case-recorded')!.textContent).toContain('No recorded finding is available')
  expect(host.querySelector<HTMLAnchorElement>('.case-evidence-links a')?.hash)
    .toBe(`#/point-rendering?case=comparison&evidence=${source.pages[0].id}`)
  const group = host.querySelector<HTMLElement>('.case-group-navigation')!
  expect(group.getAttribute('aria-label')).toBe('Other experiments in Rendering and interaction')
  expect(group.querySelector('a[href="#/straight-links"]')).not.toBeNull()
  expect(group.querySelector('a[href="#/point-rendering"]')).toBeNull()
})
