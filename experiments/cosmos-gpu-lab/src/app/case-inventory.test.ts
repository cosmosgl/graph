import { expect, it, vi } from 'vitest'
import { caseEvidenceLinks } from '../runtime/experiment'
import { disposeDocumentTables } from '../runtime/result-tables'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../runtime/run-layout'
import { createAppShell } from './app-shell'
import { renderCaseFrame } from './case-page'
import { caseEvidencePages, findingSection, startingCase } from './experiment-route'
import { experimentGroups, experiments } from './registry'
import { articleSectionId } from './router'
import { caseAssessments, readinessFor } from './readiness'

it('keeps each readiness assessment scoped to an existing case', () => {
  const keys = experiments.flatMap(experiment => (experiment.cases ?? []).map(item => `${experiment.id}/${item.id}`))
  expect(Object.keys(caseAssessments).sort()).toEqual(keys.sort())
  for (const key of keys) {
    const assessment = caseAssessments[key]
    expect(assessment.badge.trim(), key).not.toMatch(/^(?:needs review)?$/i)
    expect(assessment.finding.trim(), key).not.toBe('')
    expect(assessment.evidence.length, key).toBeGreaterThan(0)
    expect(assessment.next.trim(), key).not.toBe('')
    expect([assessment.badge, assessment.finding, assessment.status, assessment.next,
      ...assessment.evidence.map(item => item.text)].join(' '), key).not.toMatch(/\bM3\b|agent[- ]recipe/i)
    if (assessment.tone === 'fail') {
      expect(assessment.evidence.some(item => item.tone === 'fail') || assessment.status === 'Not adopted', key).toBe(true)
    }
    if (assessment.tone === 'pass') expect(assessment.evidence.some(item => item.tone === 'pass'), key).toBe(true)
  }
})

it('gives every experiment a practical case and accessible human-facing evidence', () => {
  for (const experiment of experiments) {
    expect(experiment.cases?.length, experiment.id).toBeGreaterThan(0)
    for (const item of experiment.cases!) {
      const label = `${experiment.id}/${item.id}`
      for (const field of [item.title, item.question, item.description, item.reference, item.acceptance]) {
        expect(field.trim().length, label).toBeGreaterThan(0)
      }
      if (item.kind !== 'recorded') expect(item.tryIt?.trim().length, label).toBeGreaterThan(0)
      const evidence = caseEvidenceLinks(item)
      expect(evidence.length, label).toBeGreaterThan(0)
      for (const link of evidence) {
        expect(link.label.trim().length, label).toBeGreaterThan(0)
        expect(link.page, label).not.toMatch(/agent[-_]?recipe/i)
        expect(experiment.pages.some(page => page.id === link.page), label).toBe(true)
      }
      if (item.recorded) {
        for (const field of [item.recorded.conclusion, item.recorded.date, item.recorded.environment, item.recorded.scope, item.recorded.limits]) {
          expect(field.trim().length, label).toBeGreaterThan(0)
        }
        expect(`${item.recorded.conclusion} ${item.recorded.limits}`, label).not.toMatch(/\bM3\b/)
      }
    }
  }
})

it('opens every experiment with its starting case and all its evidence and limits on the same page', async () => {
  const initial = window.location.href
  try {
    for (const experiment of experiments) {
      const create = vi.spyOn(experiment, 'create').mockImplementation(async host => {
        host.innerHTML = '<button data-run-action="primary">Run</button>' +
          '<div data-run-part="visualization"><canvas></canvas></div><p data-run-part="results">Current result</p>'
        mountRunLayout(host, () => summarizeRun('Ready', [], 'No checks yet'), { experiment: experiment.id })
        return { destroy: (): void => { disposeRunLayout(host) } }
      })
      const first = startingCase(experiment)
      window.history.replaceState(null, '', `#/${experiment.id}`)
      const host = document.createElement('div'); document.body.append(host)
      const shell = createAppShell(host)
      try {
        const label = experiment.id
        await vi.waitFor(() => expect(host.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
        expect(host.querySelectorAll('main h1'), label).toHaveLength(1)
        expect(host.querySelector('h1')?.textContent, label).toBe(experiment.title)
        expect(host.querySelector('.case-question')?.textContent, label).toBe(first.question)
        if (first.kind === 'recorded') {
          expect(create, label).not.toHaveBeenCalled()
          expect(host.querySelector('#case-live'), label).toBeNull()
        } else {
          expect(create, label).toHaveBeenCalledOnce()
          expect(create.mock.calls[0][1], label).toBe(first.id)
          expect(host.querySelector('#case-live')!.textContent, label).toContain(first.tryIt)
          expect(host.querySelector('#run-results')!.compareDocumentPosition(host.querySelector('#recorded-findings')!) &
            Node.DOCUMENT_POSITION_FOLLOWING, label).toBeTruthy()
        }
        const topic = experimentGroups.find(group => group.experiments.includes(experiment))!
        expect(host.querySelector('.case-topic-link')?.getAttribute('href'), label).toBe(`#/?section=catalog-${topic.id}`)
        const peers = Array.from(host.querySelectorAll('.case-group-navigation a'), link => link.getAttribute('href'))
        expect(peers, label).toEqual(topic.experiments.filter(peer => peer !== experiment).map(peer => `#/${peer.id}`))
        const findings = host.querySelector('.case-recorded')!
        expect(findings.closest('details'), label).toBeNull()
        expect(host.querySelectorAll('.case-evidence-detail summary'), label).toHaveLength(caseEvidencePages(experiment).length)
        if (experiment.singlePage) {
          for (const observation of experiment.singlePage.observations) {
            const row = findings.querySelector(`#${observation.id}`)!
            expect(row.textContent, label).toContain(observation.evidence)
            expect(row.textContent, label).toContain(observation.limits)
          }
        } else {
          expect(findings.querySelectorAll('.case-observations > li'), label).toHaveLength(experiment.cases!.length)
          for (const item of experiment.cases!) {
            const row = findings.querySelector(`#${findingSection(item)}`)!
            expect(row.textContent, label).toContain(item.recorded?.conclusion ?? 'No recorded finding is available')
            expect(row.querySelector('.case-observation-limits')!.textContent, label).toContain(item.recorded?.limits ?? item.acceptance)
            for (const observation of readinessFor(label, item).evidence) expect(row.textContent, label).toContain(observation.text)
          }
        }
        const ids = Array.from(host.querySelectorAll('[id]'), element => element.id)
        expect(new Set(ids).size, label).toBe(ids.length)
        expect(host.textContent, label).not.toContain('Instructions for agents')
      } finally { shell.destroy(); host.remove(); create.mockRestore() }
    }
  } finally { window.history.replaceState(null, '', initial) }
}, 60000)

it('opens every published evidence document inside its experiment without exposing agent instructions', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const issues: string[] = []
  try {
    for (const experiment of experiments) {
      disposeDocumentTables(host)
      const frame = renderCaseFrame(host, experiment)
      for (const page of caseEvidencePages(experiment)) {
        const label = `${experiment.id}/${page.id}`
        const id = articleSectionId(page.id)
        await frame.openEvidence(id)
        const content = frame.recorded.querySelector(`#${id}`)
        if (!content?.querySelector('.prose, .report')) issues.push(`${label}: missing evidence body`)
        if (!content?.closest('details')?.open) issues.push(`${label}: evidence did not open`)
        if (content?.querySelector('a[href*="agent-recipe"]')) issues.push(`${label}: agent recipe link`)
        const instruction = content?.textContent?.match(/\b(?:LAB_[A-Z0-9_]+|pnpm|npx|captures\/)/i)
        if (instruction) issues.push(`${label}: ${instruction[0]}`)
        for (const link of experiment.cases!.flatMap(caseEvidenceLinks)) {
          if (link.page === page.id && link.section && !content?.querySelector(`[id="${articleSectionId(link.page, link.section)}"]`)) {
            issues.push(`${label}: missing section ${link.section}`)
          }
        }
      }
      const ids = Array.from(host.querySelectorAll('[id]'), element => element.id)
      if (new Set(ids).size !== ids.length) issues.push(`${experiment.id}: duplicate evidence anchors`)
    }
    expect(issues).toEqual([])
  } finally { disposeDocumentTables(host); host.remove() }
}, 60000)
