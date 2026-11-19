import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import './styles.css'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../runtime/run-layout'
import { createAppShell } from './app-shell'
import { renderCaseFrame } from './case-page'
import { experiments, findExperiment } from './registry'
let host: HTMLElement | undefined; let shell: ReturnType<typeof createAppShell> | undefined
const initial = window.location.href
afterEach(() => { shell?.destroy(); host?.remove(); vi.restoreAllMocks(); window.history.replaceState(null, '', initial) })
it('keeps the styled experiment cards within the page at the current browser width', async () => {
  window.history.replaceState(null, '', '#/'); host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  const count = experiments.reduce((total, experiment) => total + (experiment.cases?.length ?? 1), 0)
  await vi.waitFor(() => expect(host!.querySelectorAll('.experiment-grid > li')).toHaveLength(count))
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  expect(host.querySelectorAll('main details, main [hidden]')).toHaveLength(0)
})

it('keeps the open center measurement preview inside a narrow page', async () => {
  window.history.replaceState(null, '', '#/center-mass?section=center-force-cost')
  host = document.createElement('div'); host.style.width = '320px'; document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('center-force-cost'))
  window.location.hash = '#/center-mass?section=run-diagnostics'
  await vi.waitFor(() => expect(host!.querySelector('#run-diagnostics details[open]')).not.toBeNull())
  const preview = host.querySelector('[data-scale-preview]')!.getBoundingClientRect()
  const diagnostics = host.querySelector('#run-diagnostics')!.getBoundingClientRect()
  expect(preview.width).toBeGreaterThan(0)
  expect(preview.right).toBeLessThanOrEqual(diagnostics.right)
})

it('keeps related experiment buttons in a single scrollable row below the live content', async () => {
  const originalWidth = window.innerWidth; const originalHeight = window.innerHeight
  const create = vi.spyOn(findExperiment('point-attractors')!, 'create').mockImplementation(async stage => {
    stage.innerHTML = `<section data-run-part="configuration"><label>Points <input value="1024"></label></section>
      <button data-run-action="primary">Step</button><section data-run-part="visualization"><canvas></canvas></section>
      <p data-run-part="results">Checked points</p>`
    mountRunLayout(stage, () => summarizeRun('Ready', [], 'Other inputs'), { experiment: 'point-attractors' })
    return { destroy: (): void => { disposeRunLayout(stage) } }
  })
  try {
    await page.viewport(1200, 900)
    window.history.replaceState(null, '', '#/point-attractors')
    host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
    await vi.waitFor(() => expect(host!.querySelector('.case-stage')?.getAttribute('aria-busy')).toBe('false'))
    const content = host.querySelector('.case-stage')!
    const navigation = host.querySelector('.case-navigation')!
    const row = navigation.querySelector('ul')!
    const links = Array.from(navigation.querySelectorAll<HTMLAnchorElement>('.case-nav-link'))
    const canvas = content.querySelector('canvas')!
    const field = content.querySelector<HTMLInputElement>('input')!
    expect(links).toHaveLength(10)
    const checkRow = (): void => {
      const stageBounds = content.getBoundingClientRect(); const navBounds = navigation.getBoundingClientRect()
      expect(navBounds.top).toBeGreaterThan(stageBounds.bottom)
      expect(navBounds.left).toBeCloseTo(stageBounds.left)
      expect(row.scrollWidth).toBeGreaterThan(row.clientWidth)
      const first = links[0].getBoundingClientRect()
      const badgeOffset = first.bottom - links[0].querySelector('.readiness-badge')!.getBoundingClientRect().bottom
      let previousRight = first.left
      for (const link of links) {
        const bounds = link.getBoundingClientRect()
        const badge = link.querySelector('.readiness-badge')!.getBoundingClientRect()
        expect(bounds.top).toBeCloseTo(first.top, 1)
        expect(bounds.left).toBeGreaterThanOrEqual(previousRight)
        expect(bounds.width).toBeCloseTo(first.width, 1)
        expect(bounds.height).toBeCloseTo(first.height, 1)
        expect(bounds.bottom - badge.bottom).toBeCloseTo(badgeOffset, 1)
        previousRight = bounds.right
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
    }
    expect(getComputedStyle(content.querySelector('.run-workbench')!).gridTemplateColumns.split(' ')).toHaveLength(2)
    checkRow()
    field.value = '8192'

    await page.viewport(320, 840)
    checkRow()
    const lastLink = links.at(-1)!
    lastLink.focus()
    await vi.waitFor(() => expect(row.scrollLeft).toBeGreaterThan(0))
    expect(lastLink.getBoundingClientRect().right).toBeLessThanOrEqual(row.getBoundingClientRect().right + 1)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
    expect(content.querySelector('canvas')).toBe(canvas)
    expect(content.querySelector('input')).toBe(field)
    expect(field.value).toBe('8192')
    expect(create).toHaveBeenCalledTimes(1)
  } finally { await page.viewport(originalWidth, originalHeight) }
})

it('keeps the same button dimensions across the experiment pages', () => {
  host = document.createElement('main'); host.className = 'workspace'; document.body.append(host)
  const sizes: Array<{ width: number; height: number }> = []
  for (const experiment of experiments) {
    for (const item of experiment.cases ?? []) {
      renderCaseFrame(host, experiment, item)
      for (const link of host.querySelectorAll('.case-nav-link')) {
        const { width, height } = link.getBoundingClientRect()
        sizes.push({ width, height })
      }
    }
  }
  expect(sizes.length).toBeGreaterThan(50)
  expect(sizes.every(size => size.width === sizes[0].width && size.height === sizes[0].height)).toBe(true)
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
