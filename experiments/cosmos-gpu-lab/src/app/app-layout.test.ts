import { afterEach, expect, it, vi } from 'vitest'
import './styles.css'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../runtime/run-layout'
import { createAppShell } from './app-shell'
import { findExperiment } from './registry'
let host: HTMLElement | undefined; let shell: ReturnType<typeof createAppShell> | undefined
const initial = window.location.href
afterEach(() => { shell?.destroy(); host?.remove(); vi.restoreAllMocks(); window.history.replaceState(null, '', initial) })
it('keeps the styled feature map within the page at the current browser width', async () => {
  window.history.replaceState(null, '', '#/'); host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelectorAll('#feature-map tbody tr')).toHaveLength(37))
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  expect(host.querySelectorAll('details,[hidden]')).toHaveLength(0)
})
it('keeps the graph before the expanded contents on narrow screens and jumps below the sticky header without rebuilding it', async () => {
  const create = vi.spyOn(findExperiment('curved-links')!, 'create').mockImplementation(async stage => {
    stage.innerHTML = `<section data-run-part="configuration"><label>Fixture <input value="custom"></label></section>
      <button data-run-action="primary">Compare</button><section data-run-part="visualization" class="backend-panels styling-panels">
      <article class="backend-panel"><div class="styling-viewport"><canvas width="512" height="320"></canvas></div></article></section>
      <p data-run-part="results">Recorded local checks</p>`
    mountRunLayout(stage, () => summarizeRun('Ready', [], 'Other inputs'), { experiment: 'curved-links' })
    return { destroy: (): void => { disposeRunLayout(stage) } }
  })
  window.history.replaceState(null, '', '#/curved-links')
  host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelector('.unified-experiment')?.getAttribute('aria-busy')).toBe('false'))
  const canvas = host.querySelector('canvas')!; const contents = host.querySelector('.experiment-contents')!
  if (window.matchMedia('(max-width: 1050px)').matches) {
    expect(contents.closest('.run-layout')).not.toBeNull()
    expect(canvas.compareDocumentPosition(contents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  } else expect(contents.parentElement?.className).toBe('experiment-document')
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  const id = 'doc-method-default-bow-boundary-investigation'
  host.querySelector<HTMLAnchorElement>(`.experiment-contents a[href$="section=${id}"]`)!.click()
  await vi.waitFor(() => expect(document.activeElement?.id).toBe(id))
  const header = host.querySelector('.lab-header')!.getBoundingClientRect()
  expect(host.querySelector(`#${id}`)!.getBoundingClientRect().top).toBeGreaterThanOrEqual(header.bottom - 1)
  expect(host.querySelector('canvas')).toBe(canvas); expect(create).toHaveBeenCalledTimes(1)
  expect(host.querySelector('input')!.value).toBe('custom')
})
