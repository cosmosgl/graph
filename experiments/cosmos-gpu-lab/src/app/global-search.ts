import { experimentMiniCard } from './experiment-mini-card'
import { readinessFor } from './readiness'
import { findExperiment } from './registry'
import { liveCaseSection, startingCase } from './experiment-route'
import { experimentHref, experimentSectionHref } from './router'
import type { SearchIndex, SearchResult } from './search-index'

type SearchModule = typeof import('./search-index')
type SearchNavigation = { experimentId?: string }
type QuickJumpResult = Pick<SearchResult, 'title' | 'kind' | 'href' | 'experimentId' | 'readiness'>
  & Partial<Pick<SearchResult, 'heading' | 'context' | 'snippet'>>
const previewLimit = 4
const suggestedExperiments = [
  ['point-styling', 'picking'],
  ['precision-diagnostics', 'gravity-accuracy'],
  ['viewer-comparison', 'compare-viewers'],
].flatMap(([experimentId, caseId]) => {
  const experiment = findExperiment(experimentId)
  const item = experiment?.cases?.find(candidate => candidate.id === caseId)
  if (!experiment || !item) return []
  return [{
    title: item.title,
    kind: 'Experiment',
    href: item === startingCase(experiment) ? experimentHref(experimentId) : experimentSectionHref(experimentId, liveCaseSection(item)),
    experimentId,
    readiness: readinessFor(experimentId, item),
  }]
})

function searchResultLink (result: QuickJumpResult, terms: RegExp | undefined, expanded: boolean): HTMLAnchorElement {
  const experiment = result.kind === 'Experiment' || result.kind === 'Live case'
  const link = experiment ? experimentMiniCard(result.title, result.href, result.readiness) : document.createElement('a')
  link.classList.add('global-search-result')
  link.href = result.href
  link.tabIndex = -1
  link.setAttribute('role', 'option')
  const title = link.querySelector<HTMLElement>('.case-nav-title') ?? document.createElement('span')
  title.classList.add('global-search-title')
  title.textContent = result.title
  if (terms) {
    title.replaceChildren(...result.title.split(terms).map((part, index) => {
      if (index % 2 === 0) return document.createTextNode(part)
      const mark = document.createElement('mark')
      mark.textContent = part
      return mark
    }))
  }
  if (!experiment) link.append(title)
  if (terms) {
    const kind = document.createElement('span')
    kind.className = 'global-search-kind'
    kind.textContent = result.kind
    link.append(kind)
  }
  if (!experiment) {
    const location = [result.context, result.heading].filter(Boolean).join(' · ')
    if (location) {
      const context = document.createElement('span')
      context.className = 'global-search-location'
      context.textContent = location
      link.append(context)
    }
    if (result.snippet && (expanded || !location)) {
      const excerpt = document.createElement('span')
      excerpt.className = 'global-search-snippet'
      excerpt.textContent = result.snippet
      link.append(excerpt)
    }
  }
  return link
}

export function mountGlobalSearch (header: HTMLElement, onNavigate: (target: SearchNavigation) => void): () => void {
  const form = header.querySelector<HTMLFormElement>('.global-search')!
  const input = form.querySelector<HTMLInputElement>('input')!
  const panel = form.querySelector<HTMLElement>('.global-search-results')!
  const status = panel.querySelector<HTMLElement>('[data-search-status]')!
  const list = panel.querySelector<HTMLOListElement>('ol')!
  const actions = panel.querySelector<HTMLElement>('.global-search-actions')!
  const more = actions.querySelector<HTMLButtonElement>('[data-search-more]')!
  const retry = actions.querySelector<HTMLButtonElement>('[data-search-retry]')!
  const keys = actions.querySelector<HTMLElement>('.global-search-keys')!
  const clear = form.querySelector<HTMLButtonElement>('[data-search-clear]')!

  const controller = new AbortController()
  const { signal } = controller
  let indexPromise: Promise<{ module: SearchModule; index: SearchIndex }> | undefined
  let results: QuickJumpResult[] = []
  let links: HTMLAnchorElement[] = []
  let active = 0
  let version = 0
  let expanded = false
  let loading = false
  let openWhenReady = false

  const dismiss = (): void => {
    version++
    openWhenReady = false
    loading = false
    panel.hidden = true
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
  }
  const select = (index: number, scroll = false): void => {
    links[active]?.setAttribute('aria-selected', 'false')
    active = index
    const link = links[index]
    if (!link) { input.removeAttribute('aria-activedescendant'); return }
    link.setAttribute('aria-selected', 'true')
    input.setAttribute('aria-activedescendant', link.id)
    if (scroll) {
      const option = link.getBoundingClientRect()
      const bounds = list.getBoundingClientRect()
      if (option.bottom > bounds.bottom) list.scrollTop += option.bottom - bounds.bottom
      else if (option.top < bounds.top) list.scrollTop += option.top - bounds.top
    }
  }
  const render = (): void => {
    const visible = expanded ? results : results.slice(0, previewLimit)
    const words = input.value.match(/[\p{L}\p{N}]+/gu) ?? []
    const terms = words.length ? new RegExp(`(${words.sort((a, b) => b.length - a.length).join('|')})`, 'giu') : undefined
    links = visible.map((result, index) => {
      const link = searchResultLink(result, terms, expanded)
      link.id = `lab-search-option-${index}`
      link.setAttribute('aria-selected', 'false')
      return link
    })
    list.replaceChildren(...links.map(link => {
      const item = document.createElement('li')
      item.setAttribute('role', 'presentation')
      item.append(link)
      return item
    }))
    select(active)
    const count = results.length
    const total = `${count} ${count === 1 ? 'result' : 'results'}`
    status.textContent = visible.length < count ? `Top ${visible.length} of ${total}` : total
    if (!input.value.trim()) status.textContent = count ? 'Suggested experiments' : 'Type to search the lab.'
    else if (!count) status.textContent = 'No matching results.'
    if (!retry.hidden) status.textContent += ' Some pages could not be searched.'
    more.textContent = expanded ? 'Show fewer' : `Show all ${count} results`
    more.hidden = count <= previewLimit
    keys.hidden = !count
    actions.hidden = !count && retry.hidden
  }
  const update = async (): Promise<void> => {
    const query = input.value.trim()
    clear.hidden = !input.value
    dismiss()
    const request = version
    panel.hidden = false
    input.setAttribute('aria-expanded', 'true')
    expanded = false
    active = 0
    retry.hidden = true
    list.scrollTop = 0
    if (!query) {
      results = suggestedExperiments
      render()
      return
    }
    loading = true
    results = []; links = []
    list.replaceChildren()
    status.textContent = 'Searching the lab…'
    actions.hidden = true
    try {
      indexPromise ??= import('./search-index').then(async module => {
        const index = await module.buildSearchIndex()
        if (index.unavailable) indexPromise = undefined
        return { module, index }
      }).catch((error: unknown) => { indexPromise = undefined; throw error })
      const { module, index } = await indexPromise
      if (request !== version) return
      results = module.searchIndex(index, query)
      loading = false
      retry.hidden = !index.unavailable
      render()
      if (openWhenReady) links[active]?.click()
    } catch {
      if (request !== version) return
      loading = false
      status.textContent = 'Search could not load.'
      actions.hidden = false
      retry.hidden = false
      more.hidden = true
      keys.hidden = true
    }
  }
  const activate = (): void => {
    if (panel.hidden) { update(); return }
    if (loading) openWhenReady = true
    else if (links[active]) links[active].click()
    else if (!retry.hidden) update()
  }
  const onFocus = (): void => { if (panel.hidden) update() }
  input.addEventListener('input', update, { signal })
  input.addEventListener('focus', onFocus, { signal })
  input.addEventListener('click', onFocus, { signal })
  form.addEventListener('submit', event => { event.preventDefault(); activate() }, { signal })
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Enter') { event.preventDefault(); activate(); return }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    if (panel.hidden) { update(); return }
    if (!results.length) return
    const next = Math.max(0, Math.min(results.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)))
    if (next >= links.length) { expanded = true; render() }
    select(next, true)
  }, { signal })
  clear.addEventListener('click', () => { input.value = ''; update(); input.focus({ preventScroll: true }) }, { signal })
  more.addEventListener('click', () => {
    expanded = !expanded
    active = expanded ? previewLimit : 0
    render()
    input.focus({ preventScroll: true })
    select(active, true)
  }, { signal })
  retry.addEventListener('click', () => { input.focus(); update() }, { signal })
  list.addEventListener('click', event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a') : null
    const result = link && results[links.indexOf(link)]
    if (!result) return
    onNavigate({ experimentId: result.experimentId })
    dismiss()
  }, { signal })
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.defaultPrevented) return
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      input.focus()
      onFocus()
    } else if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault()
      input.focus({ preventScroll: true })
      dismiss()
    }
  }, { signal })
  const dismissOutside = (event: Event): void => {
    if (!panel.hidden && event.target instanceof Node && !form.contains(event.target)) dismiss()
  }
  document.addEventListener('pointerdown', dismissOutside, { signal })
  document.addEventListener('focusin', dismissOutside, { signal })
  window.addEventListener('blur', dismiss, { signal })
  window.addEventListener('hashchange', dismiss, { signal })
  return () => { controller.abort(); dismiss() }
}
