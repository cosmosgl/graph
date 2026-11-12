import { afterEach, expect, it, vi } from 'vitest'
import type { Mock, MockInstance } from 'vitest'
import type { ExperimentDefinition } from '../runtime/experiment'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../runtime/run-layout'
import { validationContracts } from '../runtime/validation'
import { createAppShell } from './app-shell'
import { experiments, findExperiment } from './registry'
import { research } from './research'
import { readRoute } from './router'

let host: HTMLElement | undefined
let shell: ReturnType<typeof createAppShell> | undefined
const initial = window.location.href
afterEach(() => {
  shell?.destroy(); host?.remove(); vi.restoreAllMocks()
  window.history.replaceState(null, '', initial)
})

async function route (hash: string, ready: () => void): Promise<void> {
  window.location.hash = hash
  await vi.waitFor(ready)
}

function mockRun (id: string): { create: MockInstance<ExperimentDefinition['create']>; pause: Mock; destroy: Mock } {
  const pause = vi.fn(); const destroy = vi.fn()
  const create = vi.spyOn(findExperiment(id)!, 'create').mockImplementation(async stage => {
    let tick = 0
    stage.innerHTML = `<section data-run-part="configuration"><label>Fixture <input value="custom"></label></section>
      <button data-run-action="primary">Step</button><section data-run-part="visualization"><canvas></canvas></section>
      <p data-run-part="results" data-test-tick>0</p><p data-run-part="explanation">Original guidance.</p>
      ${id === 'point-styling' ? '' : '<button data-run-action="diagnostic">Trace</button>'}`
    stage.querySelector('button')!.addEventListener('click', () => { stage.querySelector('[data-test-tick]')!.textContent = String(++tick) })
    mountRunLayout(stage, () => summarizeRun('Ready', [], 'Other inputs'), { experiment: id })
    return { pause, destroy: (): void => { disposeRunLayout(stage); destroy() } }
  })
  return { create, pause, destroy }
}

it('puts every visible migration decision before the complete experiment catalog without starting GPU work', async () => {
  const creates = experiments.map(experiment => vi.spyOn(experiment, 'create'))
  window.history.replaceState(null, '', '#/')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.experiment-catalog')).not.toBeNull())
  const catalog = host.querySelector('.experiment-catalog')!
  const decisions = host.querySelectorAll('[data-decision]')
  expect(decisions).toHaveLength(4)
  for (const section of decisions) {
    expect(section.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(section.closest('details,[hidden]')).toBeNull()
  }
  expect(host.querySelectorAll('.experiment-card')).toHaveLength(experiments.length)
  expect(host.querySelector('[data-decision="gate"] a[href="#/point-styling"]')).not.toBeNull()
  expect(host.querySelector('[data-decision="milestone"] a[href="#/roadmap?section=milestone-rendering"]')).not.toBeNull()
  creates.forEach(create => expect(create).not.toHaveBeenCalled())
})

it('keeps technical article routes readable without creating GPU sessions', async () => {
  const creates = experiments.map(experiment => vi.spyOn(experiment, 'create'))
  window.history.replaceState(null, '', '#/')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  for (const experiment of experiments) {
    await route(`#/${experiment.id}/docs/${research[experiment.id].method}`, () => {
      expect(host!.querySelector('.experiment-return')?.getAttribute('href')).toBe(`#/${experiment.id}`)
      expect(host!.querySelector('.prose')?.textContent).toContain(validationContracts[experiment.id].acceptance)
    })
    expect(host.querySelector('.page-tabs,.method-topics,.research-breadcrumb,details')).toBeNull()
  }
  creates.forEach(create => expect(create).not.toHaveBeenCalled())
}, 20_000)

it('preserves old base-route Run bookmarks and focuses the requested result', async () => {
  const { create } = mockRun('point-rendering')
  window.history.replaceState(null, '', '#/point-rendering?section=run-results')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('run-results'))
  expect(host.querySelector('.research-conclusion')).not.toBeNull()
  expect(create).toHaveBeenCalledTimes(1)
})

it('preserves explicit isolated-link diagnostic entry points', () => {
  for (const backend of ['WebGL', 'WebGPU']) {
    window.history.replaceState(null, '', `?linkDiagnostic=${backend}#/weighted-links`)
    expect(readRoute()).toMatchObject({ experimentId: 'weighted-links', view: 'run' })
    window.history.replaceState(null, '', `?linkDiagnostic=${backend}#/weighted-links/run`)
    expect(readRoute()).toMatchObject({ experimentId: 'weighted-links', view: 'run' })
    window.history.replaceState(null, '', `?linkDiagnostic=${backend}#/weighted-links/evidence`)
    expect(readRoute()).toMatchObject({ experimentId: 'weighted-links', view: 'evidence' })
  }
  window.history.replaceState(null, '', '?#/weighted-links')
  expect(readRoute()).toMatchObject({ experimentId: 'weighted-links', view: undefined })
})

for (const { id } of experiments) {
  it(`keeps ${id} on one visible page and preserves its run through sections, aliases and articles`, async () => {
    const { create, pause, destroy } = mockRun(id)
    const definition = findExperiment(id)!
    window.history.replaceState(null, '', `#/${id}`)
    host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
    await vi.waitFor(() => expect(host!.querySelector('.unified-experiment')?.getAttribute('aria-busy')).toBe('false'))
    const canvas = host.querySelector('canvas')!; const input = host.querySelector('input')!
    const findings = host.querySelector('[data-recorded-report]')!
    expect(host.querySelector('.research-conclusion')!.textContent).toBe(research[id].conclusion)
    expect(host.querySelector('.page-tabs,.method-topics,.research-actions,.run-contents,.evidence-index,details')).toBeNull()
    expect(host.querySelectorAll('main > .experiment-stage > nav')).toHaveLength(1)
    expect(host.querySelectorAll('main h1')).toHaveLength(1)
    expect(host.querySelector('#run-explanation')!.textContent).toContain('Original guidance.')
    for (const value of Object.values(validationContracts[id]).slice(1)) expect(host.textContent).toContain(value)
    for (const page of definition.pages) {
      if (page.id !== research[id].evidence) expect(host.querySelector(`.experiment-notes a[href="#/${id}/docs/${page.id}"]`)).not.toBeNull()
    }
    for (const link of host.querySelectorAll<HTMLAnchorElement>('.experiment-contents a')) {
      const section = new URLSearchParams(link.hash.split('?')[1]).get('section')
      expect(host.querySelector(`#${section}`)).not.toBeNull()
    }
    expect(host.querySelector('.recorded-findings')!.textContent).not.toContain('Historical baseline')
    if (!research[id].evidence) expect(findings.textContent).toContain('No recorded measurement matrix')
    else expect(findings.querySelector('article')).not.toBeNull()
    host.querySelector<HTMLButtonElement>('.run-primary-actions button')!.click()
    const pausesBeforeSection = pause.mock.calls.length
    host.querySelector<HTMLAnchorElement>('.experiment-contents a[href$="section=run-explanation"]')!.click()
    expect(document.activeElement?.id).toBe('run-explanation')
    expect(create).toHaveBeenCalledTimes(1); expect(pause).toHaveBeenCalledTimes(pausesBeforeSection)
    await route(`#/${id}/docs/${research[id].method}`, () => expect(host!.querySelector('.unified-document .prose')).not.toBeNull())
    expect(host.querySelector('.experiment-return')?.getAttribute('href')).toBe(`#/${id}`)
    expect(host.querySelector('.page-tabs,.method-topics,.research-breadcrumb')).toBeNull()
    await route(`#/${id}/run?section=run-results`, () => expect(document.activeElement?.id).toBe('run-results'))
    expect(window.location.hash).toBe(`#/${id}?section=run-results`)
    expect(host.querySelector('canvas')).toBe(canvas); expect(host.querySelector('input')).toBe(input)
    expect(host.querySelector('[data-test-tick]')!.textContent).toBe('1')
    await route(`#/${id}/evidence`, () => expect(document.activeElement?.id).toBe('recorded-findings'))
    expect(window.location.hash).toBe(`#/${id}?section=recorded-findings`)
    expect(host.querySelector('[data-recorded-report]')).toBe(findings)
    expect(create).toHaveBeenCalledTimes(1)
    await route('#/?section=experiment-catalog', () => expect(document.activeElement?.id).toBe('experiment-catalog'))
    expect(destroy).toHaveBeenCalledTimes(1)
  })
}
