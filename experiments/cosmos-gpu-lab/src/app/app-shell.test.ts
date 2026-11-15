import { afterEach, expect, it, vi } from 'vitest'
import type { Mock, MockInstance } from 'vitest'
import type { ExperimentDefinition } from '../runtime/experiment'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../runtime/run-layout'
import { validationContracts } from '../runtime/validation'
import { createAppShell } from './app-shell'
import { experiments, findExperiment } from './registry'
import { research } from './research'
import { articleSectionId, readRoute } from './router'

let host: HTMLElement | undefined
let shell: ReturnType<typeof createAppShell> | undefined
const initial = window.location.href
afterEach(async () => {
  shell?.destroy(); host?.remove(); vi.restoreAllMocks()
  window.history.replaceState(null, '', initial)
  // Let native history/focus work drain between the route-heavy experiments.
  // A tight burst can throttle same-document navigation in a real browser.
  await new Promise<void>(resolve => { setTimeout(resolve, 500) })
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
  expect(host.querySelector('[data-decision="gate"] a[href="#/straight-links"]')).not.toBeNull()
  expect(host.querySelector('[data-decision="milestone"] a[href="#/roadmap?section=milestone-rendering"]')).not.toBeNull()
  creates.forEach(create => expect(create).not.toHaveBeenCalled())
})

it('keeps the complete document readable when GPU initialization fails', async () => {
  const create = vi.spyOn(findExperiment('center-mass')!, 'create').mockRejectedValue(new Error('Test adapter unavailable'))
  window.history.replaceState(null, '', '#/center-mass/docs/algorithm?section=webgpu-reduction')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('doc-algorithm-webgpu-reduction'))
  expect(window.location.hash).toBe('#/center-mass?section=doc-algorithm-webgpu-reduction')
  expect(host.textContent).toContain('Live experiment unavailable')
  for (const page of findExperiment('center-mass')!.pages) expect(host.querySelector(`#${articleSectionId(page.id)}`)).not.toBeNull()
  expect(host.textContent).toContain(validationContracts['center-mass'].acceptance)
  expect(host.querySelector('details')).toBeNull()
  expect(create).toHaveBeenCalledTimes(1)
})

it('rejects an unknown legacy article without creating a device', async () => {
  const create = vi.spyOn(findExperiment('center-mass')!, 'create')
  window.history.replaceState(null, '', '#/center-mass/docs/unknown')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.textContent).toContain('Unknown experiment'))
  expect(create).not.toHaveBeenCalled()
})

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
    expect(host.querySelectorAll('main nav')).toHaveLength(1)
    expect(host.querySelector('.sidebar,.experiment-return,.unified-document')).toBeNull()
    expect(host.querySelectorAll('main h1')).toHaveLength(1)
    expect(host.querySelector('#run-explanation')!.textContent).toContain('Original guidance.')
    for (const value of Object.values(validationContracts[id]).slice(1)) expect(host.textContent).toContain(value)
    for (const page of definition.pages) expect(host.querySelector(`#${articleSectionId(page.id)}`)).not.toBeNull()
    const ids = Array.from(host.querySelectorAll('[id]'), node => node.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const link of host.querySelectorAll<HTMLAnchorElement>('.experiment-contents a')) {
      const section = new URLSearchParams(link.hash.split('?')[1]).get('section')
      expect(host.querySelector(`#${section}`)).not.toBeNull()
    }
    if (!research[id].evidence) expect(findings.textContent).toContain('No recorded measurement matrix')
    else expect(findings.querySelector('article')).not.toBeNull()
    host.querySelector<HTMLButtonElement>('.run-primary-actions button')!.click()
    const pausesBeforeSection = pause.mock.calls.length
    host.querySelector<HTMLAnchorElement>('.experiment-contents a[href$="section=run-explanation"]')!.click()
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('run-explanation'))
    expect(create).toHaveBeenCalledTimes(1); expect(pause).toHaveBeenCalledTimes(pausesBeforeSection)
    await route(`#/${id}/docs/${research[id].method}`, () => expect(document.activeElement?.id).toBe(articleSectionId(research[id].method)))
    expect(window.location.hash).toBe(`#/${id}?section=${articleSectionId(research[id].method)}`)
    expect(host.querySelector('.page-tabs,.method-topics,.research-breadcrumb')).toBeNull()
    expect(pause).toHaveBeenCalledTimes(pausesBeforeSection)
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
