import { afterEach, expect, it, vi } from 'vitest'
import './styles.css'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../runtime/run-layout'
import { createAppShell } from './app-shell'
import { experiments, findExperiment } from './registry'
let host: HTMLElement | undefined; let shell: ReturnType<typeof createAppShell> | undefined
const initial = window.location.href
afterEach(() => { shell?.destroy(); host?.remove(); vi.restoreAllMocks(); window.history.replaceState(null, '', initial) })
it('keeps the styled experiment cards within the page at the current browser width', async () => {
  window.history.replaceState(null, '', '#/'); host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelectorAll('.experiment-grid > li')).toHaveLength(experiments.length))
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  expect(host.querySelectorAll('main details, main [hidden]')).toHaveLength(0)
})
it('keeps the graph before its finding and returns from evidence without rebuilding it', async () => {
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
  await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
  const canvas = host.querySelector('canvas')!
  const finding = host.querySelector('#recorded-findings')!
  expect(canvas.compareDocumentPosition(finding) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  host.querySelector<HTMLAnchorElement>('.case-evidence-links a')!.click()
  const id = 'doc-case-evidence-what-was-compared'
  await vi.waitFor(() => expect(host!.querySelector(`#${id}`)).not.toBeNull())
  host.querySelector<HTMLAnchorElement>(`#${id} .section-permalink`)!.click()
  await vi.waitFor(() => expect(document.activeElement?.id).toBe(id))
  const header = host.querySelector('.lab-header')!.getBoundingClientRect()
  expect(host.querySelector(`#${id}`)!.getBoundingClientRect().top).toBeGreaterThanOrEqual(header.bottom - 1)
  host.querySelector<HTMLAnchorElement>('[data-back]')!.click()
  await vi.waitFor(() => expect(host!.querySelector('canvas')).toBe(canvas))
  expect(create).toHaveBeenCalledTimes(1)
  expect(host.querySelector<HTMLInputElement>('.experiment-run input')!.value).toBe('custom')
})
