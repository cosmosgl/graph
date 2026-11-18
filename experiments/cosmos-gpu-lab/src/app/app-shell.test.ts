import { afterEach, expect, it, vi } from 'vitest'
import type { Mock, MockInstance } from 'vitest'
import type { ExperimentDefinition } from '../runtime/experiment'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../runtime/run-layout'
import { validationContracts } from '../runtime/validation'
import { createAppShell } from './app-shell'
import { experiments, findExperiment } from './registry'
import { migrationFocus, research } from './research'
import { journeySteps } from './journey'
import { coverage } from './coverage'
import { articleSectionId, readRoute } from './router'

let host: HTMLElement | undefined
let shell: ReturnType<typeof createAppShell> | undefined
const initial = window.location.href
const currentStep = journeySteps.find(step => step.number === migrationFocus.step)!
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

it('puts feature coverage and the current action before a regroupable catalog without starting GPU work', async () => {
  const creates = experiments.map(experiment => vi.spyOn(experiment, 'create'))
  window.history.replaceState(null, '', '#/')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.experiment-catalog')).not.toBeNull())
  const catalog = host.querySelector('.experiment-catalog')!
  const decisions = host.querySelectorAll('[data-decision]')
  expect(decisions).toHaveLength(2)
  for (const section of decisions) {
    expect(section.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(section.closest('details,[hidden]')).toBeNull()
  }
  expect(host.querySelectorAll('.experiment-card')).toHaveLength(experiments.length)
  expect(host.querySelector(`[data-decision="focus"] a[href="#/${migrationFocus.experiment}"]`)).not.toBeNull()
  expect(host.querySelectorAll('#feature-map tbody tr')).toHaveLength(coverage.length)
  expect(Array.from(host.querySelectorAll('.experiment-card[data-current]'), card => card.getAttribute('href')))
    .toEqual([`#/${migrationFocus.experiment}`])
  const grouping = host.querySelector<HTMLSelectElement>('[data-catalog-grouping]')!
  grouping.value = 'reading'; grouping.dispatchEvent(new Event('change'))
  expect(host.querySelector('#catalog-foundations')).not.toBeNull()
  expect(host.querySelectorAll('.experiment-card')).toHaveLength(experiments.length)
  expect(host.querySelector(`[data-decision="next"] a[href="#/roadmap?section=journey-${currentStep.id}"]`)).not.toBeNull()
  creates.forEach(create => expect(create).not.toHaveBeenCalled())
})

it('keeps the current step consistent on the roadmap and resolves feature-row links without starting a device', async () => {
  const creates = experiments.map(experiment => vi.spyOn(experiment, 'create'))
  window.history.replaceState(null, '', '#/roadmap')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector(`#journey-${currentStep.id}`)).not.toBeNull())
  expect(host.querySelector('[data-nav="roadmap"]')!.getAttribute('aria-current')).toBe('page')
  expect(host.querySelector('.lab-position')!.textContent).toContain(findExperiment(migrationFocus.experiment)!.title)
  expect(host.querySelector(`#journey-${currentStep.id}`)!.textContent).toContain(research[migrationFocus.experiment].next)
  expect(host.querySelector('.flow-branches')!.textContent).toContain('Simulation')
  expect(host.querySelector('.flow-branches')!.textContent).toContain('Rendering and interaction')
  await route('#/feature-inventory?section=feature-curved-links', () => expect(document.activeElement?.id).toBe('feature-curved-links'))
  expect(host.querySelector('[data-nav="feature-inventory"]')!.getAttribute('aria-current')).toBe('page')
  expect(host.querySelector('#feature-curved-links')!.textContent).toContain('Curved links')
  expect(host.querySelector('.coverage-summary')!.textContent).toContain('37 feature rows')
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

it('opens an agent recipe from a direct link', async () => {
  mockRun('precision-diagnostics')
  window.history.replaceState(null, '', '#/precision-diagnostics?section=doc-agent-recipe')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('doc-agent-recipe'))
})

it('keeps the recorded result readable and offers retry when live setup fails', async () => {
  const { create } = mockRun('viewer-comparison')
  create.mockRejectedValueOnce(new Error('Test adapter unavailable'))
  window.history.replaceState(null, '', '#/viewer-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.unified-experiment')?.getAttribute('aria-busy')).toBe('false'))
  await vi.waitFor(() => expect(host!.querySelector('[data-study-status]')!.textContent).toContain('Test adapter unavailable'))
  expect(host.querySelector('#study-overview')!.textContent).toContain(findExperiment('viewer-comparison')!.study!.record.conclusion)
  expect(host.querySelector('#doc-agent-recipe')).not.toBeNull()
  expect(host.querySelector('.experiment-contents a[href$="section=doc-agent-recipe"]')).not.toBeNull()
  const retry = host.querySelector<HTMLButtonElement>('[data-start-study]')!
  expect(retry.hidden).toBe(false); retry.click()
  await vi.waitFor(() => expect(host!.querySelector('canvas')).not.toBeNull())
  expect(create).toHaveBeenCalledTimes(2)
})

it('keeps the contents links when a delayed live setup fails', async () => {
  let rejectSetup!: (error: Error) => void
  const pending = new Promise<never>((resolve, reject) => { rejectSetup = reject })
  vi.spyOn(findExperiment('viewer-comparison')!, 'create').mockImplementation(async stage => {
    stage.innerHTML = '<div data-run-part="visualization">Graph</div><p data-run-part="explanation">Live guidance.</p>'
    mountRunLayout(stage, () => summarizeRun('Loading', [], 'Other inputs'), { experiment: 'viewer-comparison' })
    return await pending
  })
  window.history.replaceState(null, '', '#/viewer-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.unified-experiment')?.getAttribute('aria-busy')).toBe('false'))
  const ids = Array.from(host.querySelectorAll('[id]'), node => node.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(host.querySelector('.experiment-contents a[href$="section=doc-agent-recipe"]')).not.toBeNull()
  rejectSetup(new Error('Delayed setup failure'))
  await vi.waitFor(() => expect(host!.querySelector('[data-study-status]')?.textContent).toContain('Delayed setup failure'))
  expect(host.querySelector('.experiment-contents a[href$="section=doc-agent-recipe"]')).not.toBeNull()
  expect(host.querySelector('#doc-agent-recipe')).not.toBeNull()
})

it('retires a viewer whose notes fail while setup is still running', async () => {
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve }); const destroy = vi.fn()
  vi.spyOn(findExperiment('viewer-comparison')!, 'create').mockImplementation(async stage => {
    stage.innerHTML = '<iframe></iframe>'; await pending; return { destroy }
  })
  const query = Element.prototype.querySelector
  vi.spyOn(Element.prototype, 'querySelector').mockImplementation(function (this: Element, selector: string) {
    if (this.classList.contains('study-notes-host') && selector === '.run-layout') throw new Error('Notes failed')
    return query.call(this, selector)
  } as typeof Element.prototype.querySelector)
  window.history.replaceState(null, '', '#/viewer-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  try {
    await vi.waitFor(() => expect(host!.querySelector('.failure')).not.toBeNull())
    finish(); await vi.waitFor(() => expect(destroy).toHaveBeenCalledTimes(1))
  } finally { finish() }
})

it('keeps one recorded result when returning to the retained live viewer', async () => {
  const { create } = mockRun('viewer-comparison')
  window.history.replaceState(null, '', '#/viewer-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('[data-study-status]')).toBeNull())
  const canvas = host.querySelector('canvas')!
  await route('#/validation-workflow', () => expect(host!.querySelector('h1')!.textContent).toBe('Validation workflow'))
  await route('#/viewer-comparison', () => {
    expect(host!.querySelector('canvas')).toBe(canvas)
    expect(host!.querySelector('[data-study-status]')).toBeNull()
    expect(host!.querySelectorAll('#study-overview')).toHaveLength(1)
  })
  expect(create).toHaveBeenCalledTimes(1)
})

for (const { id } of experiments) {
  it(`keeps ${id} on one visible page and preserves its run through sections, aliases and articles`, async () => {
    const { create, pause, destroy } = mockRun(id)
    const definition = findExperiment(id)!
    window.history.replaceState(null, '', `#/${id}`)
    host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
    await vi.waitFor(() => expect(host!.querySelector('.unified-experiment')?.getAttribute('aria-busy')).toBe('false'))
    await vi.waitFor(() => expect(host!.querySelector('.experiment-run canvas')).not.toBeNull())
    const canvas = host.querySelector('canvas')!; const input = host.querySelector('input')!
    const findings = host.querySelector('[data-recorded-report]')!
    expect(host.querySelector('.research-conclusion')!.textContent).toBe(definition.study?.record.conclusion ?? research[id].conclusion)
    expect(host.querySelector('.experiment-role')!.textContent?.includes('Current investigation')).toBe(id === migrationFocus.experiment)
    for (const article of host.querySelectorAll<HTMLElement>('.experiment-article')) {
      expect(host.querySelector(`.experiment-contents a[href$="section=${article.id}"]`)).not.toBeNull()
      for (const heading of article.querySelectorAll('[data-heading-level="2"]')) {
        expect(host.querySelector(`.experiment-contents a[href$="section=${heading.id}"]`)).not.toBeNull()
      }
    }
    expect(host.querySelector('.page-tabs,.method-topics,.research-actions,.run-contents,.evidence-index,details')).toBeNull()
    expect(host.querySelectorAll('main nav')).toHaveLength(1)
    expect(host.querySelector('.sidebar,.experiment-return,.unified-document')).toBeNull()
    expect(host.querySelectorAll('main h1')).toHaveLength(1)
    expect(host.querySelector('.experiment-run')!.textContent).toContain('Original guidance.')
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
