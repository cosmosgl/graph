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
      if (item.tryIt !== undefined) expect(item.tryIt.trim().length, label).toBeGreaterThan(0)
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

it('opens every experiment at its recorded findings with its starting case and evidence', async () => {
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
      window.history.replaceState(null, '', `#/${experiment.id}?section=recorded-findings`)
      const host = document.createElement('div'); document.body.append(host)
      const shell = createAppShell(host)
      try {
        const label = experiment.id
        await vi.waitFor(() => expect(document.activeElement?.id).toBe('recorded-findings'))
        expect(host.querySelectorAll('main h1'), label).toHaveLength(1)
        expect(host.querySelector('h1')?.textContent, label).toBe(experiment.title)
        const summary = host.querySelector('.case-header .case-recorded-summary')
        const assessment = readinessFor(label, first)
        const badge = summary?.querySelector<HTMLElement>('.readiness-badge')
        expect(badge?.textContent, label).toContain(assessment.badge)
        expect(badge?.dataset.tone, label).toBe(assessment.tone)
        expect(summary?.querySelector('p')?.textContent, label).toBe(assessment.finding)
        expect(summary?.querySelector('a'), label).toBeNull()
        expect(host.querySelectorAll('.case-header p'), label).toHaveLength(1)
        expect(host.querySelector('.case-header')?.nextElementSibling?.className, label).toBe('case-stage')
        expect(host.querySelectorAll('main details'), label).toHaveLength(0)
        const article = experiment.presentation === 'finding-first'
        if (first.kind === 'recorded') {
          expect(create, label).not.toHaveBeenCalled()
          expect(host.querySelector('#case-live'), label).toBeNull()
        } else {
          expect(create, label).toHaveBeenCalledOnce()
          expect(create.mock.calls[0][1], label).toBe(first.id)
          const live = host.querySelector('#case-live')!
          expect(host.querySelector('.case-stage')?.firstElementChild, label).toBe(live)
          const canvas = live.querySelector('canvas')!
          expect(canvas, label).not.toBeNull()
          const configuration = live.querySelector('#run-configuration')!
          expect(configuration.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING, label).toBeTruthy()
          if (!article) {
            expect(canvas.compareDocumentPosition(host.querySelector('#recorded-findings')!) &
              Node.DOCUMENT_POSITION_FOLLOWING, label).toBeTruthy()
            if (first.tryIt) expect(host.querySelector('#case-comparison .case-instruction')?.textContent, label).toBe(first.tryIt)
          }
        }
        const topic = experimentGroups.find(group => group.experiments.includes(experiment))!
        expect(host.querySelector('.case-topic-link')?.getAttribute('href'), label).toBe(`#/?section=catalog-${topic.id}`)
        const peers = Array.from(host.querySelectorAll('.case-group-navigation a'), link => link.getAttribute('href'))
        expect(peers, label).toEqual(experiment.presentation ? [] : topic.experiments.filter(peer => peer !== experiment).map(peer => `#/${peer.id}`))
        const evidence = Array.from(host.querySelectorAll('[data-evidence-content]'))
        expect(evidence, label).toHaveLength(article ? 1 : caseEvidencePages(experiment).length)
        await vi.waitFor(() => {
          for (const page of evidence) expect(page.querySelector('.prose, .report'), `${label}/${page.id}`).not.toBeNull()
        })
        const findings = host.querySelector('.case-recorded')
        if (experiment.singlePage) {
          for (const observation of experiment.singlePage.observations) {
            const row = findings!.querySelector(`#${observation.id}`)!
            expect(row.textContent, label).toContain(observation.evidence)
            expect(row.textContent, label).toContain(observation.limits)
          }
        } else if (findings) {
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
        if (content?.closest('details')) issues.push(`${label}: evidence is hidden`)
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
