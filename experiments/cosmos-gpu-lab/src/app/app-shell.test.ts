import { afterEach, expect, it, vi } from 'vitest'
import type { Mock, MockInstance } from 'vitest'
import type { ExperimentDefinition } from '../runtime/experiment'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../runtime/run-layout'
import { caseEvidenceLinks } from '../runtime/experiment'
import { createAppShell } from './app-shell'
import { startingCase } from './experiment-route'
import { experimentGroups, experiments, findExperiment } from './registry'
import { migrationFocus, research } from './research'
import { articleSectionId, readRoute } from './router'
import { readinessFor } from './readiness'

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
      <button data-run-action="diagnostic">Trace</button>`
    stage.querySelector('button')!.addEventListener('click', () => { stage.querySelector('[data-test-tick]')!.textContent = String(++tick) })
    mountRunLayout(stage, () => summarizeRun('Ready', [], 'Other inputs'), { experiment: id })
    return { pause, destroy: (): void => { disposeRunLayout(stage); destroy() } }
  })
  return { create, pause, destroy }
}

it('shows topic cards and the global search without starting GPU work', async () => {
  const creates = experiments.map(experiment => vi.spyOn(experiment, 'create'))
  window.history.replaceState(null, '', '#/')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.experiment-catalog')).not.toBeNull())
  const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('a[data-experiment-id]'))
  expect(links).toHaveLength(experiments.length)
  expect(host.querySelectorAll('.experiment-grid > li')).toHaveLength(experiments.length)
  for (const group of experimentGroups) expect(host.querySelector(`#catalog-${group.id}`)?.textContent).toBe(group.title)
  const pointLinks = host.querySelectorAll<HTMLAnchorElement>('[aria-labelledby="catalog-point-styling"] .experiment-card')
  expect(Array.from(pointLinks, link => link.hash).sort()).toEqual(['#/point-images', '#/point-picking', '#/point-rings-greyout', '#/point-shapes'])
  expect(links.some(link => link.hash === '#/point-styling')).toBe(false)
  for (const experiment of experiments) {
    const item = startingCase(experiment)
    const link = host.querySelector<HTMLAnchorElement>(`a[data-experiment-id="${experiment.id}"][href="#/${experiment.id}"]`)
    expect(link?.querySelector('h4')?.textContent).toBe(experiment.title)
    const assessment = readinessFor(experiment.id, item)
    expect(link?.querySelector('.readiness-badge')?.textContent).toContain(assessment.badge)
    expect(link?.querySelector('.experiment-card-finding')?.textContent).toContain(assessment.finding)
    if (item.kind === 'recorded') expect(link?.textContent).toContain('Recorded study')
  }
  expect(host.querySelector('[data-catalog-grouping], .lab-position')).toBeNull()
  expect(host.querySelector('form[role="search"] label[for="lab-search"]')!.textContent).toBe('Search the lab')
  expect(host.querySelector<HTMLInputElement>('#lab-search')!.value).toBe('')
  expect(host.querySelector<HTMLElement>('.global-search-results')!.hidden).toBe(true)
  expect(links.every(link => !link.closest('[hidden]'))).toBe(true)
  for (const path of ['roadmap', 'learn']) {
    expect(host.querySelector(`.lab-navigation a[href="#/${path}"]`)).not.toBeNull()
  }
  expect(host.querySelector('[data-nav="roadmap"]')!.textContent).toBe('WebGPU migration')
  expect(host.querySelector('[data-nav="feature-inventory"]')).toBeNull()
  for (const path of ['validation-workflow', 'architecture', 'vocabulary', 'concepts/reduction']) {
    expect(host.querySelector(`.home-references a[href="#/${path}"]`)).not.toBeNull()
  }
  expect(host.querySelector('.home-references')!.compareDocumentPosition(host.querySelector('.experiment-catalog')!) &
    Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  creates.forEach(create => expect(create).not.toHaveBeenCalled())
})

it('opens a suggested experiment from an empty search field with the keyboard', async () => {
  const { create } = mockRun('precision-diagnostics')
  window.history.replaceState(null, '', '#/')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  const input = host.querySelector<HTMLInputElement>('#lab-search')!
  input.focus()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  const active = document.getElementById(input.getAttribute('aria-activedescendant')!)!
  expect(active.getAttribute('href')).toBe('#/precision-diagnostics?section=try-gravity-accuracy')
  expect(active.querySelector('.readiness-badge')).not.toBeNull()
  expect(create).not.toHaveBeenCalled()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  expect(window.location.hash).toBe('#/precision-diagnostics?section=try-gravity-accuracy')
  expect(input.value).toBe('')
})

it('opens the workgroup repulsion experiment from the catalog', async () => {
  const { create } = mockRun('workgroup-repulsion')
  window.history.replaceState(null, '', '#/')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('[data-experiment-id="workgroup-repulsion"]')).not.toBeNull())
  host.querySelector<HTMLAnchorElement>('[data-experiment-id="workgroup-repulsion"]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('main h1')?.textContent).toBe(findExperiment('workgroup-repulsion')!.title))
  expect(host.querySelector('.case-question')!.textContent).toContain('workgroup buffer')
  expect(host.querySelector('.case-evidence-detail summary')).not.toBeNull()
  expect(create).toHaveBeenCalledOnce()
})

it('shows the migration content on load and focuses legacy coverage links without starting a device', async () => {
  const creates = experiments.map(experiment => vi.spyOn(experiment, 'create'))
  window.history.replaceState(null, '', '#/roadmap')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.migration-contents')).not.toBeNull())
  const page = host.querySelector('.migration-page')!
  expect(page.querySelectorAll('details, [hidden]')).toHaveLength(0)
  const notes = Array.from(page.querySelectorAll<HTMLElement>('.coverage-evidence, .coverage-baseline'))
  expect(notes).toHaveLength(74)
  expect(notes.every(note => note.getClientRects().length > 0)).toBe(true)
  expect(page.querySelector('#parked-investigations + p + ul')?.children).toHaveLength(8)
  expect(page.querySelector('#future-directions ~ pre')?.textContent).toContain('createShaderExtension')
  expect(host.querySelector('[data-nav="roadmap"]')!.getAttribute('aria-current')).toBe('page')
  expect(page.querySelector('.migration-focus')!.textContent).toContain(research[migrationFocus.experiment].next)

  page.querySelector<HTMLAnchorElement>('.migration-contents a')!.click()
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('feature-coverage'))

  for (const [legacy, target] of [
    ['#/feature-inventory', 'feature-coverage'],
    ['#/feature-inventory?section=1-simulation-forces', 'coverage-simulation'],
    ['#/feature-inventory?section=force-order-is-part-of-the-behavior', 'force-order-is-part-of-the-behavior'],
    ['#/feature-inventory?section=feature-curved-links', 'feature-curved-links'],
    ['#/roadmap?section=parked-investigations', 'parked-investigations'],
  ]) {
    await route(legacy, () => {
      expect(window.location.hash).toBe(`#/roadmap?section=${target}`)
      expect(document.activeElement?.id).toBe(target)
    })
  }
  const feature = page.querySelector<HTMLElement>('#feature-curved-links')!
  expect(feature.tagName).toBe('LI')
  expect(feature.tabIndex).toBe(-1)
  expect(feature.querySelector('.coverage-evidence')?.textContent).toContain('28 of 64 M3 cases')
  expect(host.querySelector('.migration-page')).toBe(page)
  creates.forEach(create => expect(create).not.toHaveBeenCalled())
})

it('opens a legacy center method link on the same page without starting a device', async () => {
  const create = vi.spyOn(findExperiment('center-mass')!, 'create').mockRejectedValue(new Error('Test adapter unavailable'))
  window.history.replaceState(null, '', '#/center-mass/docs/algorithm?section=webgpu-reduction')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('case-comparison'))
  expect(host.querySelector('h1')!.textContent).toBe('Center of mass')
  expect(host.querySelector('#recorded-findings, .case-intro')).not.toBeNull()
  expect(host.querySelector('.case-evidence-page, #doc-agent-recipe')).toBeNull()
  expect(create).not.toHaveBeenCalled()
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
  expect(host.querySelector('.case-question')!.textContent).toContain('same circles')
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

it('redirects an old agent recipe link to the human-facing recorded finding', async () => {
  mockRun('precision-diagnostics')
  window.history.replaceState(null, '', '#/precision-diagnostics?section=doc-agent-recipe')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('recorded-findings'))
  expect(host!.querySelector('#doc-agent-recipe')).toBeNull()
  expect(host!.textContent).not.toContain('Instructions for agents')
  expect(host!.querySelector('.case-recorded')!.textContent).toContain('addition')
})

it('keeps the recorded result readable and offers retry when live setup fails', async () => {
  const experiment = findExperiment('viewer-comparison')!
  const { create } = mockRun(experiment.id)
  create.mockRejectedValueOnce(new Error('Test adapter unavailable'))
  window.history.replaceState(null, '', '#/viewer-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-load-status')?.textContent).toContain('Test adapter unavailable'))
  expect(host.querySelector('.case-recorded')!.textContent).toContain(experiment.cases![0].recorded!.conclusion)
  expect(host.querySelector('#doc-agent-recipe')).toBeNull()
  const retry = host.querySelector<HTMLButtonElement>('.case-stage > button:not([hidden])')!
  expect(retry.hidden).toBe(false); retry.click()
  await vi.waitFor(() => expect(host!.querySelector('canvas')).not.toBeNull())
  expect(create).toHaveBeenCalledTimes(2)
})

it('keeps the selected case finding and retry available when live setup fails', async () => {
  const experiment = findExperiment('center-mass')!
  const item = experiment.cases!.find(entry => entry.id === 'center-comparison')!
  const { create } = mockRun(experiment.id)
  create.mockRejectedValueOnce(new Error('Test adapter unavailable'))
  window.history.replaceState(null, '', '#/center-mass?case=center-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-load-status')?.textContent).toContain('Test adapter unavailable'))
  expect(host.querySelector('.case-recorded')!.textContent).toContain(item.recorded!.conclusion)
  expect(host.querySelector('.case-recorded')!.textContent).toContain(experiment.singlePage!.observations[1].limits)
  expect(host.textContent).not.toContain('Instructions for agents')
  const retry = host.querySelector<HTMLButtonElement>('.case-stage > button:not([hidden])')!
  expect(retry.hidden).toBe(false); retry.click()
  await vi.waitFor(() => expect(host!.querySelector('canvas')).not.toBeNull())
  expect(create).toHaveBeenCalledTimes(2)
  expect(create.mock.calls[1][1]).toBe('center-comparison')
})

it('keeps the trajectory finding visible with an opt-in live comparison from the legacy URL', async () => {
  const { create } = mockRun('center-mass')
  window.history.replaceState(null, '', '#/center-mass?case=center-force-scale')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  expect(document.activeElement?.id).toBe('center-trajectories')
  expect(host.querySelector('#center-trajectories')!.textContent).toContain('failed the strict position comparison from tick 10')
  expect(host.querySelector('canvas')).toBeNull()
  expect(create).not.toHaveBeenCalled()
  const start = host.querySelector<HTMLButtonElement>('.case-stage > button:not([hidden])')!
  expect(start.textContent).toBe('Start the live comparison'); start.click()
  await vi.waitFor(() => expect(host!.querySelector('canvas')).not.toBeNull())
  expect(create.mock.calls[0][1]).toBe('center-comparison')
})

it('opens the old center measurement URL on the page with both local controls', async () => {
  const create = vi.spyOn(findExperiment('center-mass')!, 'create')
  window.history.replaceState(null, '', '#/center-mass?case=center-measurements')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector<HTMLInputElement>('[data-scale-counts]')?.value).toBe('8192'))
  expect(host.querySelector<HTMLInputElement>('[data-once-count]')!.value).toBe('8192')
  expect(host.querySelector('[data-scale-status]')!.textContent).toContain('Not run')
  expect(host.querySelector('[data-once-status]')!.textContent).toContain('Not run')
  expect(host.querySelector('h1')!.textContent).toBe('Center of mass')
  expect(document.activeElement?.id).toBe('run-diagnostics')
  expect(host.querySelector('#run-diagnostics details summary')!.textContent).toBe('Run local measurements')
  expect(host.querySelector<HTMLDetailsElement>('#run-diagnostics details')!.open).toBe(true)
  expect(host.querySelector<HTMLButtonElement>('[data-action="initialize"]')!.hidden).toBe(false)
  expect(create).toHaveBeenCalledTimes(1)
  expect(create.mock.calls[0][1]).toBe('center-comparison')
  expect(create.mock.calls[0][2]).toEqual({ deferComparison: true })
})

for (const id of ['pilot-viewer', 'cluster-attraction', 'point-attractors']) {
  it(`keeps ${id} findings and limits readable when live setup fails`, async () => {
    const experiment = findExperiment(id)!
    const item = experiment.cases![0]
    vi.spyOn(experiment, 'create').mockRejectedValue(new Error('Test adapter unavailable'))
    window.history.replaceState(null, '', `#/${id}?case=${item.id}`)
    host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
    await vi.waitFor(() => expect(host!.querySelector('.case-load-status')?.textContent).toContain('Test adapter unavailable'))
    const finding = host.querySelector<HTMLElement>('.case-recorded')!
    expect(finding.textContent).toContain(item.recorded!.conclusion)
    expect(finding.textContent).toContain(item.recorded!.scope)
    expect(finding.textContent).toContain(item.recorded!.limits)
    expect(finding.querySelector('.case-evidence-detail summary')).not.toBeNull()
    expect(host.textContent).not.toContain('Instructions for agents')
    expect(host.querySelector('#doc-agent-recipe')).toBeNull()
  })

  it(`places the ${id} live result before its recorded finding`, async () => {
    mockRun(id)
    window.history.replaceState(null, '', `#/${id}`)
    host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
    await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
    const finding = host.querySelector('#recorded-findings')!
    expect(host.querySelector('canvas')!.compareDocumentPosition(finding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(finding.closest('details')).toBeNull()
  })
}

it('opens the recorded pilot latency investigation without creating a GPU device', async () => {
  const create = vi.spyOn(findExperiment('pilot-viewer')!, 'create')
  window.history.replaceState(null, '', '#/pilot-viewer?case=selection-feedback')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  expect(host.querySelector('.case-recorded')!.textContent).toContain('100.4 ms')
  expect(host.querySelector('.case-recorded')!.textContent).toContain('remain unexplained')
  const experiment = findExperiment('pilot-viewer')!
  const archived = experiment.cases!.find(item => item.id === 'selection-feedback')!
  const doc = articleSectionId(caseEvidenceLinks(archived)[0].page)
  await route(`#/pilot-viewer?section=${doc}`, () => expect(document.activeElement?.id).toBe(doc))
  expect(host.querySelector(`#${doc}`)?.closest('details')?.open).toBe(true)
  expect(host.textContent).not.toContain('Instructions for agents')
  expect(create).not.toHaveBeenCalled()
})

it('keeps the finding and evidence available while delayed live setup fails', async () => {
  let rejectSetup!: (error: Error) => void
  const pending = new Promise<never>((resolve, reject) => { rejectSetup = reject })
  vi.spyOn(findExperiment('viewer-comparison')!, 'create').mockImplementation(async stage => {
    stage.innerHTML = '<div data-run-part="visualization">Graph</div><p data-run-part="explanation">Live guidance.</p>'
    mountRunLayout(stage, () => summarizeRun('Loading', [], 'Other inputs'), { experiment: 'viewer-comparison' })
    return await pending
  })
  window.history.replaceState(null, '', '#/viewer-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('true'))
  const ids = Array.from(host.querySelectorAll('[id]'), node => node.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(host.querySelector('.case-recorded')!.textContent).toContain(findExperiment('viewer-comparison')!.cases![0].recorded!.conclusion)
  expect(host.querySelector('.case-evidence-detail summary')).not.toBeNull()
  expect(host.querySelector('#doc-agent-recipe')).toBeNull()
  rejectSetup(new Error('Delayed setup failure'))
  await vi.waitFor(() => expect(host!.querySelector('.case-load-status')?.textContent).toContain('Delayed setup failure'))
  expect(host.querySelector('.case-evidence-detail summary')).not.toBeNull()
  expect(host.querySelector('#doc-agent-recipe')).toBeNull()
})

it('retires a viewer that finishes creating after the user leaves', async () => {
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve }); const destroy = vi.fn()
  const viewer = findExperiment('viewer-comparison')!
  vi.spyOn(viewer, 'create').mockImplementation(async stage => {
    stage.innerHTML = '<iframe></iframe>'; await pending; return { destroy }
  })
  window.history.replaceState(null, '', '#/viewer-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  try {
    await vi.waitFor(() => expect(host!.querySelector('iframe')).not.toBeNull())
    await route('#/', () => expect(host!.querySelector('.experiment-catalog')).not.toBeNull())
    finish(); await vi.waitFor(() => expect(destroy).toHaveBeenCalledTimes(1))
  } finally { finish() }
})

it('keeps one recorded result when returning to the retained live viewer', async () => {
  const { create } = mockRun('viewer-comparison')
  window.history.replaceState(null, '', '#/viewer-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  const canvas = host.querySelector('canvas')!
  expect(canvas.compareDocumentPosition(host.querySelector('#recorded-findings')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await route('#/validation-workflow', () => expect(host!.querySelector('h1')!.textContent).toBe('Validation workflow'))
  await route('#/viewer-comparison', () => {
    expect(host!.querySelector('canvas')).toBe(canvas)
    expect(host!.querySelectorAll('#recorded-findings')).toHaveLength(1)
  })
  expect(create).toHaveBeenCalledTimes(1)
})

it.each([
  ['point-shapes', 'shapes', 'Edge checks fail', 'doc-shapes-evidence-fractional-positions-and-sizes'],
  ['point-picking', 'picking', 'High pick cost', 'doc-picking-evidence'],
  ['point-images', 'images', 'Compatibility failed', 'doc-images-evidence'],
  ['point-rings-greyout', 'effects', 'Polygon checks fail', 'doc-effects-evidence'],
])('opens %s with its own demo, recorded badge and evidence', async (id, caseId, badge, section) => {
  const { create } = mockRun(id)
  window.history.replaceState(null, '', `#/${id}`)
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-live-slot canvas')).not.toBeNull())
  expect(create).toHaveBeenCalledWith(expect.any(HTMLElement), caseId, undefined)
  expect(host.querySelector('.case-chooser')).toBeNull()
  expect(host.querySelectorAll('.case-observations > li')).toHaveLength(1)
  expect(host.querySelector('.case-topic-link')?.textContent).toContain('Point styling and picking')
  const summary = host.querySelector('.case-recorded-summary')!
  expect(summary.querySelector('.readiness-badge')?.textContent).toContain(badge)
  expect(summary.textContent).not.toContain('Recorded finding')
  const target = summary.querySelector<HTMLAnchorElement>('a')!
  expect(target.hash).toBe(`#/${id}?section=${section}`)
  target.click()
  await vi.waitFor(() => expect(document.activeElement?.id).toBe(section))
  expect(host.querySelector(`#${section}`)?.closest('details')?.open).toBe(true)
  expect(create).toHaveBeenCalledTimes(1)
})

it('opens older point styling bookmarks at the matching demo or archived evidence', async () => {
  const picking = mockRun('point-picking')
  const images = mockRun('point-images')
  window.history.replaceState(null, '', '#/point-styling?section=run-diagnostics')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('run-diagnostics'))
  expect(window.location.hash).toBe('#/point-picking?section=run-diagnostics')
  expect(picking.create).toHaveBeenCalledWith(expect.any(HTMLElement), 'picking', undefined)

  await route('#/point-styling?case=images', () => {
    expect(window.location.hash).toBe('#/point-images')
    expect(images.create).toHaveBeenCalledWith(expect.any(HTMLElement), 'images', undefined)
  })
  await route('#/point-styling/docs/shapes-evidence?section=fractional-positions-and-sizes', () => {
    expect(window.location.hash).toBe('#/point-shapes?section=doc-shapes-evidence-fractional-positions-and-sizes')
    expect(document.activeElement?.id).toBe('doc-shapes-evidence-fractional-positions-and-sizes')
  })
  const archived = 'doc-method-stored-alpha-picking-prototype-16-november-2026'
  await route(`#/point-styling?section=${archived}`, () => {
    expect(window.location.hash).toBe(`#/point-shapes?section=${archived}`)
    expect(document.activeElement?.id).toBe(archived)
  })
})

for (const [id, caseId] of [
  ['precision-diagnostics', 'gravity-accuracy'],
  ['performance-lab', 'center-reduction'],
]) {
  it(`switches the ${id} live case without replacing the experiment findings`, async () => {
    const { create, destroy } = mockRun(id)
    const experiment = findExperiment(id)!
    const item = experiment.cases!.find(entry => entry.id === caseId)!
    const first = startingCase(experiment)
    window.history.replaceState(null, '', `#/${id}?case=${caseId}`)
    host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
    await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
    expect(host.querySelector('h1')!.textContent).toBe(experiment.title)
    expect(host.querySelector('.case-question')!.textContent).toBe(item.question)
    expect(host.querySelector('.case-intro')!.textContent).toContain(item.tryIt)
    expect(host.querySelector('.case-comparison')!.textContent).toContain(item.reference)
    expect(host.querySelector('.case-comparison')!.textContent).toContain(item.acceptance)
    const summary = host.querySelector('.case-header .case-recorded-summary')!
    expect(summary.querySelector('.readiness-badge')?.textContent).toContain(readinessFor(id, item).badge)
    expect(summary.querySelector('p')?.textContent).toBe(readinessFor(id, item).finding)
    const lookup = host.querySelector('.case-recorded')!
    expect(lookup.querySelectorAll('.case-observations > li')).toHaveLength(experiment.cases!.length)
    if (item.recorded) expect(lookup.querySelector(`#finding-${caseId}`)!.textContent).toContain(item.recorded.limits)
    expect(host.querySelector('#run-results')!.compareDocumentPosition(lookup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const details = lookup.querySelector('details')!
    details.open = true
    const chooser = host.querySelector<HTMLSelectElement>('.case-chooser select')!
    expect(chooser.value).toBe(caseId)
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][1]).toBe(caseId)
    expect(window.location.hash).toBe(`#/${id}?section=try-${caseId}`)
    chooser.value = first.id; chooser.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
    expect(create.mock.calls[1][1]).toBe(first.id)
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.case-question')!.textContent).toBe(first.question)
    expect(summary.querySelector('.readiness-badge')?.textContent).toContain(readinessFor(id, first).badge)
    expect(summary.querySelector('p')?.textContent).toBe(readinessFor(id, first).finding)
    expect(host.querySelector('.case-recorded')).toBe(lookup)
    expect(details.open).toBe(true)
    expect(host.querySelector(`.case-group-navigation a[href^="#/${id}"]`)).toBeNull()
  })
}

it('preserves the live center comparison through every inline finding and old evidence link', async () => {
  const { create, pause, destroy } = mockRun('center-mass')
  window.history.replaceState(null, '', '#/center-mass?case=center-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  const canvas = host.querySelector('canvas')!; const input = host.querySelector('.experiment-run input')!
  host.querySelector<HTMLButtonElement>('.run-primary-actions button')!.click()
  for (const [href, section] of [
    ['#/center-mass?case=center-comparison&section=center-force-cost', 'center-force-cost'],
    ['#/center-mass?case=center-measurements&evidence=trajectory-evidence', 'center-trajectories'],
    ['#/center-mass?case=center-comparison&evidence=results', 'center-accuracy'],
    ['#/center-mass?section=doc-once-findings-computing-the-center-once', 'center-once'],
    ['#/center-mass/docs/algorithm?section=webgpu-reduction', 'case-comparison'],
  ]) {
    await route(href, () => expect(document.activeElement?.id).toBe(section))
    expect(host.querySelector('canvas')).toBe(canvas)
    expect(host.querySelector('.experiment-run input')).toBe(input)
    expect(host.querySelector('[data-test-tick]')!.textContent).toBe('1')
  }
  expect(host.querySelectorAll('#recorded-findings')).toHaveLength(1)
  expect(host.querySelector('.case-evidence-page, .case-evidence-links')).toBeNull()
  expect(pause).not.toHaveBeenCalled()
  expect(create).toHaveBeenCalledTimes(1); expect(destroy).not.toHaveBeenCalled()
})

it('keeps the current run intact while searching and restores it after visiting another experiment', async () => {
  const original = mockRun('center-mass'); const next = mockRun('precision-diagnostics')
  window.history.replaceState(null, '', '#/center-mass?case=center-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  const canvas = host.querySelector('canvas')!; const setting = host.querySelector<HTMLInputElement>('.experiment-run input')!
  setting.value = 'kept setting'
  host.querySelector<HTMLButtonElement>('.run-primary-actions button')!.click()
  const search = host.querySelector<HTMLInputElement>('#lab-search')!
  search.value = 'gravity force accuracy'; search.dispatchEvent(new Event('input'))
  expect(original.pause).not.toHaveBeenCalled(); expect(original.destroy).not.toHaveBeenCalled()
  const selector = '.global-search-results a[href="#/precision-diagnostics?section=try-gravity-accuracy"]'
  await vi.waitFor(() => expect(host!.querySelector(selector)).not.toBeNull(), { timeout: 20000 })
  expect(host.querySelector('canvas')).toBe(canvas); expect(setting.value).toBe('kept setting')
  search.focus()
  expect(search.getAttribute('aria-activedescendant')).toBe(host.querySelector(selector)!.id)
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() => expect(host!.querySelector('h1')?.textContent).toBe(findExperiment('precision-diagnostics')!.title))
  await vi.waitFor(() => expect(next.create).toHaveBeenCalledTimes(1))
  expect(original.pause).toHaveBeenCalled(); expect(original.destroy).not.toHaveBeenCalled()
  window.history.back()
  await vi.waitFor(() => expect(host!.querySelector('canvas')).toBe(canvas))
  expect(host.querySelector<HTMLInputElement>('.experiment-run input')).toBe(setting)
  expect(setting.value).toBe('kept setting')
  expect(host.querySelector('[data-test-tick]')!.textContent).toBe('1')
  expect(original.create).toHaveBeenCalledTimes(1); expect(original.destroy).not.toHaveBeenCalled()
  expect(next.destroy).toHaveBeenCalledTimes(1)
  expect(search.value).toBe('gravity force accuracy')
  search.focus()
  await vi.waitFor(() => expect(host!.querySelector<HTMLElement>('.global-search-results')!.hidden).toBe(false))
  host.querySelector('main')!.focus()
  host.querySelector('main')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(host.querySelector<HTMLElement>('.global-search-results')!.hidden).toBe(true)
  expect(host.querySelector('canvas')).toBe(canvas)

  search.value = 'gravity force accuracy'; search.dispatchEvent(new Event('input'))
  await vi.waitFor(() => expect(host!.querySelector(selector)).not.toBeNull())
  host.querySelector<HTMLAnchorElement>(selector)!.click()
  await vi.waitFor(() => expect(next.create).toHaveBeenCalledTimes(2))
  search.value = 'center of mass'; search.dispatchEvent(new Event('input'))
  const originalSelector = '.global-search-results a[href="#/center-mass"]'
  await vi.waitFor(() => expect(host!.querySelector(originalSelector)).not.toBeNull())
  host.querySelector<HTMLAnchorElement>(originalSelector)!.click()
  await vi.waitFor(() => expect(host!.querySelector('canvas')).toBe(canvas))
  expect(host.querySelector<HTMLInputElement>('.experiment-run input')).toBe(setting)
  expect(setting.value).toBe('kept setting')
  expect(host.querySelector('[data-test-tick]')!.textContent).toBe('1')
  expect(original.create).toHaveBeenCalledTimes(1); expect(original.destroy).not.toHaveBeenCalled()
  expect(next.destroy).toHaveBeenCalledTimes(2)
}, 30000)

it('restores completed evidence after searching away from an embedded viewer that must restart', async () => {
  const originalMove = Object.getOwnPropertyDescriptor(Element.prototype, 'moveBefore')
  Object.defineProperty(Element.prototype, 'moveBefore', { value: undefined, configurable: true })
  const destroy = vi.fn(); const restoreEvidence = vi.fn()
  const create = vi.spyOn(findExperiment('center-mass')!, 'create').mockImplementation(async stage => {
    stage.innerHTML = '<iframe title="Fixture viewer"></iframe>'
    return { destroy, saveEvidence: (): { results: string[] } => ({ results: ['completed'] }), restoreEvidence }
  })
  const next = mockRun('precision-diagnostics')
  try {
    window.history.replaceState(null, '', '#/center-mass?case=center-comparison')
    host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
    await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
    const search = host.querySelector<HTMLInputElement>('#lab-search')!
    search.value = 'gravity force accuracy'; search.dispatchEvent(new Event('input'))
    const selector = '.global-search-results a[href="#/precision-diagnostics?section=try-gravity-accuracy"]'
    await vi.waitFor(() => expect(host!.querySelector(selector)).not.toBeNull(), { timeout: 20000 })
    host.querySelector<HTMLAnchorElement>(selector)!.click()
    await vi.waitFor(() => expect(next.create).toHaveBeenCalledTimes(1))
    expect(destroy).toHaveBeenCalledTimes(1)
    window.history.back()
    await vi.waitFor(() => expect(restoreEvidence).toHaveBeenCalledWith({ results: ['completed'] }))
    expect(create).toHaveBeenCalledTimes(2)
  } finally {
    if (originalMove) Object.defineProperty(Element.prototype, 'moveBefore', originalMove)
    else Reflect.deleteProperty(Element.prototype, 'moveBefore')
  }
}, 30000)

it('opens a recorded viewer bookmark on the same page and preserves a running comparison', async () => {
  const { create, pause, destroy } = mockRun('viewer-comparison')
  window.history.replaceState(null, '', '#/viewer-comparison')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  const canvas = host.querySelector('canvas')!
  await route('#/viewer-comparison?case=link-color-evidence', () =>
    expect(document.activeElement?.id).toBe('finding-link-color-evidence'))
  expect(host.querySelector('h1')?.textContent).toBe('Graph interaction in WebGL and WebGPU')
  expect(host.querySelector('canvas')).toBe(canvas)
  expect(create).toHaveBeenCalledTimes(1)
  expect(pause).not.toHaveBeenCalled()
  expect(destroy).not.toHaveBeenCalled()
})

it('opens the standalone demo from the previous Dense Communities bookmark', async () => {
  const { create } = mockRun('dense-communities')
  window.history.replaceState(null, '', '#/viewer-comparison?section=try-dense-communities')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  expect(window.location.hash).toBe('#/dense-communities?section=try-dense-communities')
  expect(host.querySelector('h1')?.textContent).toBe('Dense Communities')
  expect(host.querySelector('.case-chooser')).toBeNull()
  expect(create).toHaveBeenCalledTimes(1)

  await vi.waitFor(() => expect(host!.querySelector('#doc-layout .prose')?.textContent).toContain('pinned anchors'))
  expect(host.querySelector('#doc-layout')?.closest('details')).toBeNull()
  expect(host.querySelector('#case-comparison')?.closest('details')).toBeNull()
  await route('#/dense-communities?section=doc-layout', () => expect(document.activeElement?.id).toBe('doc-layout'))
  expect(create).toHaveBeenCalledTimes(1)
})

it('opens a bookmarked YouTube size and switches sizes on the same page', async () => {
  const { create, destroy } = mockRun('youtube-network')
  const subset = '#/youtube-network?section=try-friendships-262k'
  const sparse = '#/youtube-network?section=try-friendships-300k'
  window.history.replaceState(null, '', subset)
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  const sizes = host.querySelector('[role="group"][aria-label="Graph size"]')!
  const [fullSize, smallerSize, sparseSize] = sizes.querySelectorAll('button')
  const findings = host.querySelector('#recorded-findings')!
  expect(smallerSize.textContent).toBe('262,144 points')
  expect(smallerSize.getAttribute('aria-pressed')).toBe('true')
  expect(fullSize.getAttribute('aria-pressed')).toBe('false')
  expect(create.mock.calls[0][1]).toBe('friendships-262k')
  expect(host.querySelector('.case-description')?.textContent).toContain('262,144 points and 1,369,771 friendship links')
  expect(findings.closest('details')).toBeNull()
  expect(findings.querySelector('#finding-friendships-262k')).not.toBeNull()

  await route('#/youtube-network', () => expect(create.mock.calls[1]?.[1]).toBe('friendships'))
  expect(fullSize.textContent).toBe('1,000,000 points')
  expect(fullSize.getAttribute('aria-pressed')).toBe('true')
  expect(smallerSize.getAttribute('aria-pressed')).toBe('false')
  expect(destroy).toHaveBeenCalledTimes(1)

  smallerSize.click()
  await vi.waitFor(() => expect(create.mock.calls[2]?.[1]).toBe('friendships-262k'))
  expect(window.location.hash).toBe(subset)
  expect(smallerSize.getAttribute('aria-pressed')).toBe('true')
  expect(host.querySelector('#recorded-findings')).toBe(findings)

  expect(sparseSize.textContent).toBe('300,000 points · 300,000 links')
  sparseSize.click()
  await vi.waitFor(() => expect(create.mock.calls[3]?.[1]).toBe('friendships-300k'))
  expect(window.location.hash).toBe(sparse)
  expect(sparseSize.getAttribute('aria-pressed')).toBe('true')
  expect(smallerSize.getAttribute('aria-pressed')).toBe('false')
  expect(host.querySelector('.case-description')?.textContent).toContain('300,000 points and 300,000 friendship links')
})

it('keeps the Forces and motion peers discoverable from the center case', async () => {
  const { create } = mockRun('center-mass')
  window.history.replaceState(null, '', '#/center-mass')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  const peers = host.querySelector('.case-group-navigation')!
  expect(peers.getAttribute('aria-label')).toBe('More in Forces and motion')
  expect(Array.from(peers.querySelectorAll('a'), link => link.getAttribute('href'))).toEqual(
    experimentGroups.find(group => group.id === 'forces-motion')!.experiments.filter(item => item.id !== 'center-mass').map(item => `#/${item.id}`)
  )
  const attractors = findExperiment('point-attractors')!.cases![0]
  const attractorLink = peers.querySelector('a[href="#/point-attractors"]')!
  expect(attractorLink.querySelector('.case-nav-title')?.textContent).toBe(findExperiment('point-attractors')!.title)
  expect(attractorLink.querySelector('.readiness-badge')?.textContent).toContain(readinessFor('point-attractors', attractors).badge)
  const group = host.querySelector<HTMLAnchorElement>('.case-topic-link')!
  expect(group.getAttribute('href')).toBe('#/?section=catalog-forces-motion'); group.click()
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('catalog-forces-motion'))
  expect(host.querySelectorAll('.experiment-card[data-experiment-id="center-mass"]')).toHaveLength(1)
  expect(create).toHaveBeenCalledTimes(1)
})
