import { afterEach, expect, it, vi } from 'vitest'
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

it('puts every visible migration decision before the complete experiment catalog', async () => {
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
  expect(host.querySelector('[data-decision="gate"] a[href="#/point-styling/run"]')).not.toBeNull()
  expect(host.querySelector('[data-decision="milestone"] a[href="#/roadmap?section=milestone-rendering"]')).not.toBeNull()
  creates.forEach(create => expect(create).not.toHaveBeenCalled())
})

it('provides all four destinations for every experiment without starting GPU work on documentation routes', async () => {
  const creates = experiments.map(experiment => vi.spyOn(experiment, 'create'))
  window.history.replaceState(null, '', '#/')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  for (const experiment of experiments) {
    const record = research[experiment.id]
    await route(`#/${experiment.id}`, () => {
      expect(host!.querySelector('.experiment-header h1')?.textContent).toBe(experiment.title)
      expect(host!.querySelector('.research-conclusion')?.textContent).toBe(record.conclusion)
    })
    expect(Array.from(host.querySelectorAll('.page-tabs a'), a => a.textContent)).toEqual(['Overview', 'Run', 'Method', 'Evidence'])
    await route(`#/${experiment.id}/docs/${record.method}`, () => {
      expect(host!.querySelector('.page-tabs [aria-current="page"]')?.textContent).toBe('Method')
      expect(host!.querySelector('.prose')?.textContent).toContain(validationContracts[experiment.id].acceptance)
    })
    expect(host.querySelector('details')).toBeNull()
    await route(`#/${experiment.id}/evidence`, () => {
      expect(host!.querySelector('.page-tabs [aria-current="page"]')?.textContent).toBe('Evidence')
      expect(host!.querySelector('.evidence-index')?.textContent).toContain(record.conclusion)
    })
    for (const item of record.investigations) {
      expect(host.querySelector(`.evidence-index a[href="#/${experiment.id}/docs/${item.page}"]`)).not.toBeNull()
    }
  }
  creates.forEach(create => expect(create).not.toHaveBeenCalled())
}, 20_000)

it('preserves legacy Run section bookmarks while the plain route opens Overview', async () => {
  const create = vi.spyOn(findExperiment('point-rendering')!, 'create').mockImplementation(async stage => {
    stage.innerHTML = '<section id="run-results">Legacy results</section>'
    return { destroy: vi.fn() }
  })
  window.history.replaceState(null, '', '#/point-rendering?section=run-results')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('run-results'))
  expect(host.querySelector('.page-tabs [aria-current="page"]')?.textContent).toBe('Run')
  expect(create).toHaveBeenCalledTimes(1)
  await route('#/point-rendering', () => expect(host!.querySelector('.research-overview')).not.toBeNull())
  expect(host.querySelector('.page-tabs [aria-current="page"]')?.textContent).toBe('Overview')
})

it('preserves explicit isolated-link diagnostic entry points without changing ordinary overview routes', () => {
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

it('keeps tick, controls and the same run when consulting method/sections, then releases it for another experiment', async () => {
  const pause = vi.fn(); const destroy = vi.fn()
  const create = vi.spyOn(findExperiment('matched-layout')!, 'create').mockImplementation(async stage => {
    stage.style.minHeight = '2400px'
    stage.innerHTML = '<button data-test-step>Step</button><output data-test-tick>0</output><input value="custom settings">'
    let tick = 0
    stage.querySelector('button')!.addEventListener('click', () => { stage.querySelector('output')!.textContent = String(++tick) })
    return { pause, destroy }
  })
  const collision = vi.spyOn(findExperiment('collision')!, 'create')
  window.history.replaceState(null, '', '#/matched-layout/run')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('[data-test-step]')).not.toBeNull())
  const button = host.querySelector<HTMLButtonElement>('[data-test-step]')!; button.click()
  expect(host.querySelector('output')!.textContent).toBe('1')
  window.scrollTo(0, 600)
  await route('#/matched-layout/docs/method', () => expect(host!.querySelector('.prose')).not.toBeNull())
  expect(pause).toHaveBeenCalledTimes(1); expect(destroy).not.toHaveBeenCalled()
  const id = host.querySelector('.prose h2[id]')!.id
  await route(`#/matched-layout/docs/method?section=${id}`, () => expect(document.activeElement?.id).toBe(id))
  await route('#/matched-layout', () => expect(host!.querySelector('.research-overview')).not.toBeNull())
  await route('#/matched-layout/evidence', () => expect(host!.querySelector('.evidence-index')).not.toBeNull())
  await route('#/matched-layout/run', () => expect(host!.querySelector('[data-test-tick]')?.textContent).toBe('1'))
  expect(host.querySelector('[data-test-step]')).toBe(button)
  expect(window.scrollY).toBe(600)
  expect(host.querySelector('input')!.value).toBe('custom settings'); expect(create).toHaveBeenCalledTimes(1)
  await route('#/collision', () => expect(host!.querySelector('.research-overview')).not.toBeNull())
  expect(destroy).toHaveBeenCalledTimes(1); expect(collision).not.toHaveBeenCalled()
  expect(Array.from(host.querySelectorAll('.page-tabs a'), a => a.textContent)).toEqual(['Overview', 'Run', 'Method', 'Evidence'])
  await route('#/collision/docs/method', () => expect(host!.textContent).toContain(validationContracts.collision.acceptance))
  expect(host.querySelector('.research-breadcrumb,.investigation-context')).toBeNull()
  expect(host.querySelector('.experiment-header p')).toBeNull()
  expect(host.querySelector('#reference')!.closest('details')).toBeNull()
  await route('#/collision/evidence', () => expect(host!.querySelector('.evidence-index')).not.toBeNull())
  expect(host.textContent).toContain('Historical baseline')
  await route('#/collision/docs/trajectories', () => expect(host!.querySelector('.investigation-context')?.textContent).toContain('Historical baseline'))
  expect(host.querySelector('.investigation-context a')?.getAttribute('href')).toBe('#/collision/docs/precision')
  expect(collision).not.toHaveBeenCalled()
  await route('#/', () => expect(host!.querySelector('.migration-overview')).not.toBeNull())
  expect(window.scrollY).toBe(0)
  await route('#/collision/docs/does-not-exist', () => expect(host!.textContent).toContain('Unknown experiment'))
  expect(collision).not.toHaveBeenCalled()
})
