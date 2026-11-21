import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import './styles.css'
import { disposeRunLayout, mountRunLayout, summarizeRun } from '../runtime/run-layout'
import { createAppShell } from './app-shell'
import { renderCaseFrame } from './case-page'
import { experiments, findExperiment } from './registry'
import { readinessFor } from './readiness'

vi.mock('../gpu/luma', async importOriginal => ({
  ...await importOriginal<typeof import('../gpu/luma')>(),
  createDevice: async (): Promise<never> => { throw new Error('Test adapter unavailable') },
}))

let host: HTMLElement | undefined; let shell: ReturnType<typeof createAppShell> | undefined
const initial = window.location.href
afterEach(() => { shell?.destroy(); host?.remove(); vi.restoreAllMocks(); window.history.replaceState(null, '', initial) })
it('keeps the styled experiment cards within the page at the current browser width', async () => {
  window.history.replaceState(null, '', '#/'); host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(host!.querySelectorAll('.experiment-grid > li')).toHaveLength(experiments.length))
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  expect(host.querySelectorAll('main details, main [hidden]')).toHaveLength(0)
})

it('keeps the migration page and guides in the experiment reading column at both widths', async () => {
  const originalWidth = window.innerWidth; const originalHeight = window.innerHeight
  const pages = [
    ['roadmap', 'Cosmos → WebGPU'], ['learn', 'How WebGPU works'],
    ['validation-workflow', 'Validation workflow'], ['numerical-research', 'Numerical research'],
    ['architecture', 'Lab architecture'], ['vocabulary', 'Vocabulary'], ['concepts/reduction', 'Parallel reduction'],
  ]
  const expectStack = (nodes: NodeListOf<Element>, label: string): void => {
    expect(nodes.length, label).toBeGreaterThan(1)
    const first = nodes[0].getBoundingClientRect()
    let bottom = first.top
    for (const node of nodes) {
      const bounds = node.getBoundingClientRect()
      expect(bounds.left, label).toBeCloseTo(first.left)
      expect(bounds.top, label).toBeGreaterThanOrEqual(bottom - 1)
      bottom = bounds.bottom
    }
  }
  try {
    host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
    for (const width of [1440, 320]) {
      await page.viewport(width, 850)
      for (const [path, title] of pages) {
        window.location.hash = `#/${path}`
        await vi.waitFor(() => {
          expect(host!.querySelector('.reading-document > header h1')?.textContent, path).toBe(title)
          expect(host!.querySelector('.reading-document article.prose'), path).not.toBeNull()
        })
        const documentView = host.querySelector('.reading-document')!
        const bounds = documentView.getBoundingClientRect()
        expect(documentView.querySelectorAll('h1'), path).toHaveLength(1)
        expect(bounds.width, path).toBeLessThanOrEqual(560)
        expect(bounds.left, path).toBeCloseTo(document.documentElement.clientWidth - bounds.right)
        expect(document.documentElement.scrollWidth, path).toBeLessThanOrEqual(document.documentElement.clientWidth)
        const contents = documentView.querySelectorAll('.document-layout > *')
        if (contents.length) expectStack(contents, path)
        if (path === 'learn') expectStack(documentView.querySelectorAll('.learning-contents nav a'), 'Chapters')
        if (path === 'roadmap') {
          expectStack(documentView.querySelectorAll('#what-remains + ul > li'), 'What remains')
          expectStack(documentView.querySelectorAll('#parked-investigations + p + ul > li'), 'Parked investigations')
          expectStack(documentView.querySelector('.coverage-feature')!.querySelectorAll(':scope > *'), 'Coverage details')
        }
      }
    }
  } finally { await page.viewport(originalWidth, originalHeight) }
})

it('keeps Quick jump editable on a phone and shows experiment mini cards among the top matches', async () => {
  const originalWidth = window.innerWidth; const originalHeight = window.innerHeight
  try {
    await page.viewport(1200, 800)
    window.history.replaceState(null, '', '#/')
    host = document.createElement('div'); document.body.append(host); shell = createAppShell(host)
    const input = host.querySelector<HTMLInputElement>('#lab-search')!
    const panel = host.querySelector<HTMLElement>('.global-search-results')!
    const clear = host.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!
    const options = (): NodeListOf<HTMLAnchorElement> => panel.querySelectorAll('[role="option"]')
    expect(input.getBoundingClientRect().left).toBeGreaterThanOrEqual(host.querySelector('.lab-navigation')!.getBoundingClientRect().right)
    expect(window.innerWidth - input.getBoundingClientRect().right).toBeLessThanOrEqual(24)
    await page.viewport(320, 780)
    expect(input.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(window.innerWidth - input.getBoundingClientRect().right).toBeLessThanOrEqual(16)
    expect(panel.hidden).toBe(true)
    input.focus()
    expect(panel.hidden).toBe(false)
    const suggestions = Array.from(options(), link => link.hash)
    expect(suggestions).toHaveLength(3)
    expect(panel.querySelector('[role="status"]')?.textContent).toBe('Suggested experiments')
    expect(clear.hidden).toBe(true)
    input.value = 'gravity'; input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    input.value = 'point picking'; input.dispatchEvent(new Event('input'))
    await vi.waitFor(() => expect(options()).toHaveLength(4), { timeout: 20000 })
    expect(window.location.hash).toBe('#/')
    const [experiment, finding] = options()
    expect(experiment.querySelector('.case-nav-title')?.textContent).toBe('Point picking')
    expect(experiment.hash).toBe('#/point-picking')
    const picking = findExperiment('point-picking')!.cases![0]
    expect(experiment.querySelector('.readiness-badge')?.textContent).toContain(readinessFor('point-picking', picking).badge)
    expect(finding.querySelector('.global-search-kind')?.textContent).toBe('Recorded finding')
    expect(finding.querySelector('.readiness-badge')).toBeNull()
    expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
    expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(document.documentElement.clientWidth)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(input.getAttribute('aria-activedescendant')).toBe(finding.id)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(panel.hidden).toBe(true)
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('point picking')
    input.click()
    await vi.waitFor(() => expect(options()).toHaveLength(4))
    const more = panel.querySelector<HTMLButtonElement>('[data-search-more]')!
    more.click()
    expect(options().length).toBeGreaterThan(4)
    expect(more.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight)
    expect(panel.querySelector('ol')!.scrollHeight).toBeGreaterThan(panel.querySelector('ol')!.clientHeight)
    expect(clear.hidden).toBe(false)
    expect(clear.textContent).toBe('×')
    clear.click()
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
    expect(panel.hidden).toBe(false)
    expect(clear.hidden).toBe(true)
    expect(Array.from(options(), link => link.hash)).toEqual(suggestions)
  } finally {
    await page.viewport(originalWidth, originalHeight)
  }
})

it('opens both center diagnostics at a narrow width', async () => {
  window.history.replaceState(null, '', '#/center-mass?section=run-diagnostics')
  host = document.createElement('div'); host.style.width = '320px'; document.body.append(host); shell = createAppShell(host)
  await vi.waitFor(() => expect(document.activeElement?.id).toBe('run-diagnostics'))
  const diagnostics = host.querySelector('#run-diagnostics')!
  const preview = diagnostics.querySelector('[data-scale-preview]')!.getBoundingClientRect()
  expect(preview.width).toBeGreaterThan(0)
  expect(preview.right).toBeLessThanOrEqual(diagnostics.getBoundingClientRect().right)
  expect(diagnostics.querySelector<HTMLInputElement>('[data-scale-counts]')?.value).toBe('8192')
  expect(diagnostics.querySelector<HTMLInputElement>('[data-once-count]')?.value).toBe('8192')
  expect(diagnostics.querySelector('[data-scale-status]')?.textContent).toContain('Not run')
  expect(diagnostics.querySelector('[data-once-status]')?.textContent).toContain('Not run')
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
      const settings = content.querySelector('#run-configuration')!.getBoundingClientRect()
      const run = content.querySelector('#run-live-viewer')!.getBoundingClientRect()
      expect(settings.left).toBeCloseTo(run.left)
      expect(settings.width).toBeCloseTo(run.width)
      expect(settings.bottom).toBeLessThan(run.top)
      expect(stageBounds.width).toBeLessThanOrEqual(560)
    }
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
    renderCaseFrame(host, experiment)
    for (const link of host.querySelectorAll('.case-nav-link')) {
      const { width, height } = link.getBoundingClientRect()
      sizes.push({ width, height })
    }
  }
  expect(sizes.length).toBeGreaterThan(50)
  expect(sizes.every(size => size.width === sizes[0].width && size.height === sizes[0].height)).toBe(true)
})

it('shows evidence below the graph and focuses its heading without rebuilding the run', async () => {
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
  const id = 'doc-case-evidence-what-was-compared'
  await vi.waitFor(() => expect(host!.querySelector(`#${id}`)).not.toBeNull())
  expect(host.querySelector(`#${id}`)?.closest('details')).toBeNull()
  host.querySelector<HTMLAnchorElement>(`#${id} .section-permalink`)!.click()
  await vi.waitFor(() => expect(document.activeElement?.id).toBe(id))
  const header = host.querySelector('.lab-header')!.getBoundingClientRect()
  expect(host.querySelector(`#${id}`)!.getBoundingClientRect().top).toBeGreaterThanOrEqual(header.bottom - 1)
  expect(host.querySelector('canvas')).toBe(canvas)
  expect(host.querySelector('#recorded-findings')).toBe(finding)
  expect(create).toHaveBeenCalledTimes(1)
  expect(host.querySelector<HTMLInputElement>('.experiment-run input')!.value).toBe('custom')
})
