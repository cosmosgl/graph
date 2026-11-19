import { expect, it, vi } from 'vitest'
import { caseEvidenceLinks } from '../runtime/experiment'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../runtime/run-layout'
import { createAppShell } from './app-shell'
import { renderCaseEvidence } from './case-page'
import { experiments } from './registry'
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

it('renders every case with its own context, live result and visible recorded finding', async () => {
  const initial = window.location.href
  try {
    for (const experiment of experiments) {
      const create = vi.spyOn(experiment, 'create').mockImplementation(async host => {
        host.innerHTML = '<button data-run-action="primary">Run</button>' +
          '<div data-run-part="visualization"><canvas></canvas></div><p data-run-part="results">Current result</p>'
        mountRunLayout(host, () => summarizeRun('Ready', [], 'No checks yet'), { experiment: experiment.id })
        return { destroy: (): void => { disposeRunLayout(host) } }
      })
      try {
        for (const item of experiment.cases!) {
          const label = `${experiment.id}/${item.id}`
          window.history.replaceState(null, '', `#/${experiment.id}?case=${item.id}`)
          const host = document.createElement('div'); document.body.append(host)
          const shell = createAppShell(host); create.mockClear()
          try {
            await vi.waitFor(() => expect(host.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
            expect(host.querySelector('h1')?.textContent, label).toBe(item.title)
            expect(host.querySelector('.case-question')?.textContent, label).toBe(item.question)
            const assessment = readinessFor(experiment.id, item)
            const strip = host.querySelector<HTMLElement>('.case-readiness')!
            expect(strip.textContent, label).toContain(`${assessment.area} · ${assessment.status}`)
            expect(strip.textContent, label).toContain(assessment.next)
            expect(strip.querySelectorAll('.readiness-evidence'), label).toHaveLength(assessment.evidence.length)
            expect(strip.closest('details'), label).toBeNull()
            const finding = host.querySelector<HTMLElement>('.case-recorded')!
            expect(finding.closest('details'), label).toBeNull()
            expect(finding.textContent, label).toContain(item.recorded?.conclusion ?? 'No recorded finding is available')
            expect(finding.querySelector('.case-evidence-links a'), label).not.toBeNull()
            if (item.kind === 'recorded') {
              expect(create, label).not.toHaveBeenCalled()
              expect(host.querySelector('canvas'), label).toBeNull()
            } else {
              expect(create, label).toHaveBeenCalledOnce()
              expect(create.mock.calls[0][1], label).toBe(item.id)
              expect(host.querySelector('#run-results')!.compareDocumentPosition(finding) & Node.DOCUMENT_POSITION_FOLLOWING, label).toBeTruthy()
            }
            expect(host.textContent, label).not.toContain('Instructions for agents')
          } finally { shell.destroy(); host.remove() }
        }
      } finally { create.mockRestore() }
    }
  } finally { window.history.replaceState(null, '', initial) }
}, 60000)

it('opens case evidence without exposing agent recipes or command instructions', async () => {
  const host = document.createElement('div'); document.body.append(host)
  const issues: string[] = []
  try {
    for (const experiment of experiments) {
      for (const item of experiment.cases!) {
        for (const link of caseEvidenceLinks(item)) {
          const label = `${experiment.id}/${item.id}/${link.page}`
          const page = experiment.pages.find(candidate => candidate.id === link.page)!
          await renderCaseEvidence(host, experiment, item, page)
          const content = host.querySelector('[data-evidence-content]')
          if (!content?.textContent?.trim()) issues.push(`${label}: empty evidence`)
          if (content?.querySelector('a[href*="agent-recipe"]')) issues.push(`${label}: agent recipe link`)
          const instruction = content?.textContent?.match(/\b(?:LAB_[A-Z0-9_]+|pnpm|npx|captures\/)/i)
          if (instruction) issues.push(`${label}: ${instruction[0]}`)
          if (link.section && !host.querySelector(`[id="${articleSectionId(link.page, link.section)}"]`)) {
            issues.push(`${label}: missing section ${link.section}`)
          }
        }
      }
    }
    expect(issues).toEqual([])
  } finally { host.remove() }
}, 60000)
