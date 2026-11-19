import { afterEach, expect, it, vi } from 'vitest'
import type { Mock, MockInstance } from 'vitest'
import type { ExperimentDefinition } from '../runtime/experiment'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../runtime/run-layout'
import { validationContracts } from '../runtime/validation'
import { createAppShell } from './app-shell'
import { experimentGroups, experiments, findExperiment } from './registry'
import { migrationFocus, research } from './research'
import { journeySteps } from './journey'
import { articleSectionId, readRoute } from './router'
import { readinessFor } from './readiness'

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

it('shows topic cards and the global search without starting GPU work', async () => {
  const creates = experiments.map(experiment => vi.spyOn(experiment, 'create'))
  window.history.replaceState(null, '', '#/')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.experiment-catalog')).not.toBeNull())
  const count = experiments.reduce((total, experiment) => total + (experiment.cases?.length ?? 1), 0)
  const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('a[data-experiment-id]'))
  expect(links).toHaveLength(count)
  expect(host.querySelectorAll('.experiment-grid > li')).toHaveLength(count)
  for (const group of experimentGroups) expect(host.querySelector(`#catalog-${group.id}`)?.textContent).toBe(group.title)
  for (const experiment of experiments) {
    if (!experiment.cases) {
      expect(host.querySelector(`.experiment-card[href="#/${experiment.id}"]`)).not.toBeNull()
      continue
    }
    for (const item of experiment.cases) {
      const link = host.querySelector<HTMLAnchorElement>(`a[data-experiment-id="${experiment.id}"][href="#/${experiment.id}?case=${item.id}"]`)
      expect(link?.textContent).toContain(item.title)
      const assessment = readinessFor(experiment.id, item)
      expect(link?.querySelector('.readiness-badge')?.textContent).toContain(assessment.badge)
      expect(link?.querySelector('.experiment-card-finding')?.textContent).toContain(assessment.finding)
      if (item.kind === 'recorded') expect(link?.textContent).toContain('Recorded study')
    }
  }
  expect(host.querySelector('[data-catalog-grouping], .lab-position')).toBeNull()
  expect(host.querySelector('form[role="search"] label[for="lab-search"]')!.textContent).toBe('Search the lab')
  expect(host.querySelector<HTMLInputElement>('#lab-search')!.value).toBe('')
  expect(host.querySelector<HTMLElement>('.global-search-results')!.hidden).toBe(true)
  expect(links.every(link => !link.closest('[hidden]'))).toBe(true)
  for (const path of ['roadmap', 'feature-inventory', 'learn']) {
    expect(host.querySelector(`.lab-navigation a[href="#/${path}"]`)).not.toBeNull()
  }
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
  expect(active.getAttribute('href')).toBe('#/precision-diagnostics?case=gravity-accuracy')
  expect(active.querySelector('.readiness-badge')).not.toBeNull()
  expect(create).not.toHaveBeenCalled()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  expect(window.location.hash).toBe('#/precision-diagnostics?case=gravity-accuracy')
  expect(input.value).toBe('')
})

it('opens the workgroup repulsion experiment from the catalog', async () => {
  const { create } = mockRun('workgroup-repulsion')
  window.history.replaceState(null, '', '#/')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('[data-experiment-id="workgroup-repulsion"]')).not.toBeNull())
  host.querySelector<HTMLAnchorElement>('[data-experiment-id="workgroup-repulsion"]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('main h1')?.textContent).toBe('Compare workgroup repulsion'))
  expect(host.querySelector('.case-question')!.textContent).toContain('workgroup buffer')
  expect(host.querySelector('.case-evidence-links a')!.textContent).toContain('evidence')
  expect(create).toHaveBeenCalledOnce()
})

it('keeps the current step consistent on the roadmap and resolves feature-row links without starting a device', async () => {
  const creates = experiments.map(experiment => vi.spyOn(experiment, 'create'))
  window.history.replaceState(null, '', '#/roadmap')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector(`#journey-${currentStep.id}`)).not.toBeNull())
  expect(host.querySelector('.lab-navigation a')!.getAttribute('href')).toBe('#/?section=experiment-catalog')
  expect(host.querySelector('[data-nav="roadmap"]')!.getAttribute('aria-current')).toBe('page')
  expect(host.querySelector('.lab-position')).toBeNull()
  expect(host.querySelector(`#journey-${currentStep.id}`)!.textContent).toContain(research[migrationFocus.experiment].next)
  expect(host.querySelector('.flow-branches')!.textContent).toContain('Simulation')
  expect(host.querySelector('.flow-branches')!.textContent).toContain('Rendering and interaction')
  await route('#/feature-inventory?section=feature-curved-links', () => expect(document.activeElement?.id).toBe('feature-curved-links'))
  expect(host.querySelector('[data-nav="feature-inventory"]')!.getAttribute('aria-current')).toBe('page')
  expect(host.querySelector('[data-nav="roadmap"]')!.hasAttribute('aria-current')).toBe(false)
  expect(host.querySelector('#feature-curved-links')!.textContent).toContain('Curved links')
  expect(host.querySelector('.coverage-summary')!.textContent).toContain('37 feature rows')
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
  const retry = host.querySelector<HTMLButtonElement>('.case-stage button')!
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
  const retry = host.querySelector<HTMLButtonElement>('.case-stage button')!
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
  const start = host.querySelector<HTMLButtonElement>('.case-live-slot > button')!
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
    expect(finding.querySelector('.case-evidence-links a')).not.toBeNull()
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
  host.querySelector<HTMLAnchorElement>('.case-evidence-links a')!.click()
  await vi.waitFor(() => expect(host!.querySelector('.case-evidence-page h1')?.textContent).toBe('Selection feedback evidence'))
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
  expect(host.querySelector('.case-evidence-links a')).not.toBeNull()
  expect(host.querySelector('#doc-agent-recipe')).toBeNull()
  rejectSetup(new Error('Delayed setup failure'))
  await vi.waitFor(() => expect(host!.querySelector('.case-load-status')?.textContent).toContain('Delayed setup failure'))
  expect(host.querySelector('.case-evidence-links a')).not.toBeNull()
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

for (const [id, caseId] of [
  ['precision-diagnostics', 'gravity-accuracy'],
  ['point-styling', 'picking'],
]) {
  it(`opens the ${id} ${caseId} case with its own context and finding`, async () => {
    const { create } = mockRun(id)
    const experiment = findExperiment(id)!
    const item = experiment.cases!.find(entry => entry.id === caseId)!
    window.history.replaceState(null, '', `#/${id}?case=${caseId}`)
    host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
    await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
    expect(host.querySelector('h1')!.textContent).toBe(item.title)
    expect(host.querySelector('.case-question')!.textContent).toBe(item.question)
    expect(host.querySelector('.case-description')!.textContent).toBe(item.description)
    expect(host.querySelector('.case-intro')!.textContent).toContain(item.tryIt)
    expect(host.querySelector('.case-comparison')!.textContent).toContain(item.reference)
    expect(host.querySelector('.case-comparison')!.textContent).toContain(item.acceptance)
    expect(host.querySelector('.case-recorded')!.textContent).toContain(item.recorded!.conclusion)
    expect(host.querySelector('.case-recorded')!.textContent).toContain(item.recorded!.limits)
    expect(host.querySelector('#run-results')!.compareDocumentPosition(host.querySelector('.case-recorded')!) &
      Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const diagnostics = host.querySelector('#run-diagnostics')
    if (diagnostics) {
      expect(host.querySelector('.case-comparison')!.compareDocumentPosition(diagnostics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    const navigation = host.querySelector<HTMLElement>('.case-navigation')!
    expect(navigation.getAttribute('aria-label')).toBe(`More in ${experiment.title}`)
    expect(navigation.querySelectorAll('a')).toHaveLength(experiment.cases!.length - 1)
    expect(host.querySelector('.lab-navigation a')!.getAttribute('href')).toBe('#/?section=experiment-catalog')
    for (const other of experiment.cases!.filter(entry => entry.id !== caseId)) {
      const link = navigation.querySelector(`a[href="#/${id}?case=${other.id}"]`)!
      const assessment = readinessFor(id, other)
      expect(link.querySelector('.case-nav-title')!.textContent).toBe(other.title)
      expect(link.querySelector('.readiness-badge')!.textContent).toContain(assessment.badge)
      expect(link.querySelector('.readiness-badge')!.getAttribute('data-tone')).toBe(assessment.tone)
    }
    expect(navigation.querySelector(`a[href="#/${id}?case=${caseId}"]`)).toBeNull()
    expect(host.querySelector('canvas')).not.toBeNull()
    expect(host.querySelector('#doc-agent-recipe, .study-finding-reproduction')).toBeNull()
    expect(host.textContent).not.toContain('Instructions for agents')
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][1]).toBe(caseId)
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
  const selector = '.global-search-results a[href="#/precision-diagnostics?case=gravity-accuracy"]'
  await vi.waitFor(() => expect(host!.querySelector(selector)).not.toBeNull(), { timeout: 20000 })
  expect(host.querySelector('canvas')).toBe(canvas); expect(setting.value).toBe('kept setting')
  search.focus()
  expect(search.getAttribute('aria-activedescendant')).toBe(host.querySelector(selector)!.id)
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await vi.waitFor(() => expect(host!.querySelector('h1')?.textContent).toBe('Gravity force accuracy'))
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
  const originalSelector = '.global-search-results a[href="#/center-mass?case=center-comparison"]'
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
    const selector = '.global-search-results a[href="#/precision-diagnostics?case=gravity-accuracy"]'
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

it('destroys the previous run when switching to a separate recorded case', async () => {
  const { create, destroy } = mockRun('viewer-comparison')
  window.history.replaceState(null, '', '#/viewer-comparison?case=compare-viewers')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  host.querySelector<HTMLAnchorElement>('.case-navigation a[href="#/viewer-comparison?case=link-color-evidence"]')!.click()
  await vi.waitFor(() => {
    expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false')
    expect(host!.querySelector('h1')?.textContent).toBe('Investigate link-color differences')
  })
  expect(destroy).toHaveBeenCalledTimes(1)
  expect(create).toHaveBeenCalledTimes(1)
  expect(host.querySelector('canvas')).toBeNull()
  expect(host.querySelector('.case-navigation a[href="#/viewer-comparison?case=compare-viewers"]')).not.toBeNull()
})

it('keeps the Forces and motion peers discoverable from the center case', async () => {
  const { create } = mockRun('center-mass')
  window.history.replaceState(null, '', '#/center-mass')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  const peers = host.querySelector('.case-group-navigation')!
  expect(peers.getAttribute('aria-label')).toBe('More in Forces and motion')
  expect(Array.from(peers.querySelectorAll('a'), link => link.getAttribute('href'))).toEqual(['#/cluster-attraction', '#/point-attractors'])
  const attractors = findExperiment('point-attractors')!.cases![0]
  const attractorLink = peers.querySelector('a[href="#/point-attractors"]')!
  expect(attractorLink.querySelector('.case-nav-title')?.textContent).toBe(attractors.title)
  expect(attractorLink.querySelector('.readiness-badge')?.textContent).toContain(readinessFor('point-attractors', attractors).badge)
  const group = host.querySelector<HTMLAnchorElement>('.case-topic-link')!
  expect(group.getAttribute('href')).toBe('#/?section=catalog-forces-motion'); group.click()
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('catalog-forces-motion'))
  expect(host.querySelectorAll('.experiment-card[data-experiment-id="center-mass"]')).toHaveLength(1)
  expect(create).toHaveBeenCalledTimes(1)
})

for (const { id } of experiments.filter(experiment => !experiment.cases)) {
  it(`keeps ${id} on one visible page and preserves its run through sections, aliases and articles`, async () => {
    const { create, pause, destroy } = mockRun(id)
    const definition = findExperiment(id)!
    window.history.replaceState(null, '', `#/${id}`)
    host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
    await vi.waitFor(() => expect(host!.querySelector('.unified-experiment')?.getAttribute('aria-busy')).toBe('false'))
    await vi.waitFor(() => expect(host!.querySelector('.experiment-run canvas')).not.toBeNull())
    const canvas = host.querySelector('canvas')!; const input = host.querySelector('.experiment-run input')!
    const findings = host.querySelector('[data-recorded-report]')!
    expect(host.querySelector('.research-conclusion')!.textContent).toBe(definition.study?.record.conclusion ?? research[id].conclusion)
    expect(host.querySelector('.experiment-role')).toBeNull()
    for (const article of host.querySelectorAll<HTMLElement>('.experiment-article')) {
      expect(host.querySelector(`.experiment-contents a[href$="section=${article.id}"]`)).not.toBeNull()
    }
    expect(host.querySelector('.experiment-contents ul ul')).toBeNull()
    expect(host.querySelector('.page-tabs,.method-topics,.research-actions,.run-contents,.evidence-index,details')).toBeNull()
    expect(host.querySelectorAll('main nav')).toHaveLength(1)
    expect(host.querySelector('.sidebar,.experiment-return,.unified-document')).toBeNull()
    expect(host.querySelectorAll('main h1')).toHaveLength(1)
    expect(host.querySelector('.experiment-run')!.textContent).toContain('Original guidance.')
    for (const value of Object.values(validationContracts[id]).slice(1)) expect(host.textContent).toContain(value)
    for (const page of definition.pages) {
      if (page.id === 'agent-recipe') expect(host.querySelector(`#${articleSectionId(page.id)}`)).toBeNull()
      else expect(host.querySelector(`#${articleSectionId(page.id)}`)).not.toBeNull()
    }
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
    expect(host.querySelector('canvas')).toBe(canvas); expect(host.querySelector('.experiment-run input')).toBe(input)
    expect(host.querySelector('[data-test-tick]')!.textContent).toBe('1')
    await route(`#/${id}/evidence`, () => expect(document.activeElement?.id).toBe('recorded-findings'))
    expect(window.location.hash).toBe(`#/${id}?section=recorded-findings`)
    expect(host.querySelector('[data-recorded-report]')).toBe(findings)
    expect(create).toHaveBeenCalledTimes(1)
    await route('#/?section=experiment-catalog', () => expect(document.activeElement?.id).toBe('experiment-catalog'))
    expect(destroy).toHaveBeenCalledTimes(1)
  })
}
