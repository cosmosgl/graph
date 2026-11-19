import type { SearchIndex, SearchResult } from './search-index'

type SearchModule = typeof import('./search-index')
type SearchNavigation = { experimentId?: string; caseId?: string }

export function mountGlobalSearch (header: HTMLElement, onNavigate: (target: SearchNavigation) => void): () => void {
  const form = header.querySelector<HTMLFormElement>('.global-search')!
  const input = form.querySelector<HTMLInputElement>('input')!
  const toggle = header.querySelector<HTMLButtonElement>('.search-toggle')!
  const panel = header.querySelector<HTMLElement>('.global-search-results')!
  const status = panel.querySelector<HTMLElement>('[data-search-status]')!
  const list = panel.querySelector<HTMLOListElement>('ol')!
  const close = panel.querySelector<HTMLButtonElement>('[data-search-close]')!
  let modulePromise: Promise<SearchModule> | undefined
  let indexPromise: Promise<SearchIndex> | undefined
  let version = 0; let disposed = false; let suppressFocus = false

  const getIndex = async (): Promise<{ module: SearchModule; index: SearchIndex }> => {
    modulePromise ??= import('./search-index')
    const module = await modulePromise
    indexPromise ??= module.buildSearchIndex()
    const index = await indexPromise
    if (index.unavailable) indexPromise = undefined
    return { module, index }
  }

  const dismiss = (restoreFocus = false): void => {
    version++; panel.hidden = true; form.dataset.expanded = 'false'; toggle.setAttribute('aria-expanded', 'false')
    if (restoreFocus) {
      suppressFocus = true
      if (window.matchMedia('(max-width: 700px)').matches) toggle.focus()
      else input.focus()
      suppressFocus = false
    }
  }

  const resultLink = (result: SearchResult): HTMLLIElement => {
    const item = document.createElement('li'); const link = document.createElement('a')
    link.href = result.href; link.className = 'global-search-result'
    const title = document.createElement('strong'); title.textContent = result.title
    const location = document.createElement('span'); location.className = 'global-search-location'
    location.textContent = [result.kind, result.context, result.heading].filter(Boolean).join(' · ')
    link.append(title, location)
    if (result.snippet) {
      const excerpt = document.createElement('span'); excerpt.className = 'global-search-snippet'
      excerpt.textContent = result.snippet; link.append(excerpt)
    }
    link.addEventListener('click', event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      onNavigate({ experimentId: result.experimentId, caseId: result.caseId }); dismiss()
    })
    item.append(link); return item
  }

  const update = (): void => {
    const query = input.value.trim(); const request = ++version
    panel.hidden = false; list.replaceChildren()
    if (!query) { status.textContent = 'Enter a word or phrase to search the lab.'; return }
    status.textContent = 'Searching the lab…'
    getIndex().then(({ module, index }) => {
      if (disposed || request !== version || panel.hidden) return
      const results = module.searchIndex(index, query)
      status.textContent = results.length ? `${results.length} ${results.length === 1 ? 'result' : 'results'} for “${query}”` : `No results for “${query}”.`
      if (index.unavailable) status.textContent += ' Some pages could not be searched; submit again to retry.'
      list.replaceChildren(...results.map(resultLink))
    }).catch(() => {
      modulePromise = undefined; indexPromise = undefined
      if (!disposed && request === version && !panel.hidden) status.textContent = 'Search could not load. Submit again to retry.'
    })
  }
  const submit = (event: Event): void => { event.preventDefault(); update() }
  const onInput = (): void => { update() }
  const onFocus = (): void => { if (!suppressFocus && input.value.trim()) update() }
  const onToggle = (): void => {
    if (form.dataset.expanded === 'true') { dismiss(true); return }
    form.dataset.expanded = 'true'; toggle.setAttribute('aria-expanded', 'true'); input.focus()
  }
  const onClose = (): void => { dismiss(true) }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || (panel.hidden && form.dataset.expanded !== 'true')) return
    event.preventDefault(); dismiss(true)
  }
  const onPointer = (event: PointerEvent): void => {
    if (!(event.target instanceof Node) || form.contains(event.target) || panel.contains(event.target) || toggle.contains(event.target)) return
    if (!panel.hidden || form.dataset.expanded === 'true') dismiss()
  }
  form.addEventListener('submit', submit); input.addEventListener('input', onInput); input.addEventListener('focus', onFocus)
  toggle.addEventListener('click', onToggle); close.addEventListener('click', onClose)
  document.addEventListener('keydown', onKey); document.addEventListener('pointerdown', onPointer)
  return () => {
    disposed = true; version++
    form.removeEventListener('submit', submit); input.removeEventListener('input', onInput); input.removeEventListener('focus', onFocus)
    toggle.removeEventListener('click', onToggle); close.removeEventListener('click', onClose)
    document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer)
  }
}
