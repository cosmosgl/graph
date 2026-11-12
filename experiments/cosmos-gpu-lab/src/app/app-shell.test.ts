import { afterEach, expect, it, vi } from 'vitest'
import { validationContracts } from '../runtime/validation'
import { createAppShell } from './app-shell'
import { findExperiment } from './registry'
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
  window.history.replaceState(null, '', '#/matched-layout')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('[data-test-step]')).not.toBeNull())
  const button = host.querySelector<HTMLButtonElement>('[data-test-step]')!; button.click()
  expect(host.querySelector('output')!.textContent).toBe('1')
  window.scrollTo(0, 600)
  await route('#/matched-layout/docs/method', () => expect(host!.querySelector('.prose')).not.toBeNull())
  expect(pause).toHaveBeenCalledTimes(1); expect(destroy).not.toHaveBeenCalled()
  const id = host.querySelector('.prose h2[id]')!.id
  await route(`#/matched-layout/docs/method?section=${id}`, () => expect(document.activeElement?.id).toBe(id))
  await route('#/matched-layout', () => expect(host!.querySelector('[data-test-tick]')?.textContent).toBe('1'))
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
