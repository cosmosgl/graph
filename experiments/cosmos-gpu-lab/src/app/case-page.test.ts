import { expect, it } from 'vitest'
import { disposeDocumentTables } from '../runtime/result-tables'
import { findExperiment } from './registry'
import { renderEvidenceContent, renderCaseFrame } from './case-page'

async function checkEvidence (experimentId: string, pageId: string, check: (host: HTMLElement) => void): Promise<void> {
  const experiment = findExperiment(experimentId)!
  const page = experiment.pages.find(item => item.id === pageId)!
  const host = document.createElement('div'); document.body.append(host)
  try {
    await renderEvidenceContent(host, experiment, page)
    check(host)
  } finally { disposeDocumentTables(host); host.remove() }
}

it('keeps the timeout distinct from missing and unreached selections at the tested YouTube sizes', async () => {
  await checkEvidence('viewer-comparison', 'migration-results', host => {
    const figure = host.querySelector('.result-workflow')!
    const rows = Array.from(figure.querySelectorAll('tbody tr'), row => [
      row.querySelector('th')!.textContent,
      ...Array.from(row.querySelectorAll<HTMLTableCellElement>('td'), cell => cell.dataset.outcome),
    ])
    expect(rows).toEqual([
      ['262,144', 'completed', 'completed', 'completed'],
      ['524,288', 'completed', 'completed', 'no-result'],
      ['786,432', 'completed', 'no-result', 'no-result'],
      ['1,000,000', 'completed', 'timeout', 'not-reached'],
    ])
    expect(figure.textContent).toContain('The two middle sizes used short checks.')
  })
})

it('renders the original recorded pick phases on the same scale as the 50 ms target', async () => {
  await checkEvidence('pilot-viewer', 'latency-evidence', host => {
    const figure = host.querySelector('.result-pick-timing')!
    expect(Array.from(figure.querySelectorAll('dd'), duration => duration.textContent)).toEqual(['3.3 ms', '4.3 ms', '92.8 ms'])
    expect(Array.from(figure.querySelectorAll('.result-pick-axis span'), label => label.textContent))
      .toEqual(['0', '50 ms target', '100.4 ms total'])
    const plot = figure.querySelector<HTMLElement>('.result-pick-plot')!
    expect(parseFloat(plot.style.getPropertyValue('--pick-target-position'))).toBeCloseTo(50 / 100.4 * 100)
  })
})

it('shows the recorded point count at each resize and the capacity held after the final shrink', async () => {
  await checkEvidence('point-capacity', 'reuse', host => {
    const timeline = host.querySelector('.result-capacity-timeline')!
    expect(Array.from(timeline.querySelectorAll('.result-capacity-steps strong'), label => label.textContent))
      .toEqual(['2,048', '8,192', '4,096', '8,192', '2,048'])
    expect(Array.from(timeline.querySelectorAll('.result-capacity-end span'), label => label.textContent))
      .toEqual(['8,192 slots held', '2,048 active points'])
    const held = timeline.querySelector('.result-capacity-held')!
    expect(Array.from(held.querySelectorAll('line[x2="100%"]'), line => line.getAttribute('y2'))).toEqual(['10%'])
  })
})

it('keeps findings and provenance readable while leaving replay instructions in the source', async () => {
  const experiment = findExperiment('center-mass')!
  const host = document.createElement('div'); document.body.append(host)
  try {
    await renderEvidenceContent(host, experiment, {
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
  } finally { disposeDocumentTables(host); host.remove() }
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
  renderCaseFrame(host, experiment)
  expect(host.querySelector('.case-recorded')!.textContent).toContain('No recorded finding is available')
  expect(host.querySelector('.case-evidence > h2')?.textContent).toBe(source.pages[0].title)
  expect(host.querySelector('.case-evidence details')).toBeNull()
  const group = host.querySelector<HTMLElement>('.case-group-navigation')!
  expect(group.getAttribute('aria-label')).toBe('More in Rendering and interaction')
  expect(group.querySelector('a[href="#/straight-links"]')).not.toBeNull()
  expect(group.querySelector('a[href="#/point-rendering"]')).toBeNull()
})
