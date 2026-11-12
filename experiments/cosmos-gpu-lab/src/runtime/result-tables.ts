// Tables keep their authored values and semantics. This only adds accessible
// scrolling and header associations, including tables inserted during a run.
type Dispose = () => void
const documents = new WeakMap<HTMLElement, Dispose>()

export function createResultTables (host: HTMLElement): { refresh(): void; destroy(): void } {
  const regions = new Map<HTMLTableElement, { region: HTMLElement; hint: HTMLElement }>()
  const update = (): void => {
    for (const [table, { region, hint }] of regions) {
      if (!host.contains(table)) { resize.unobserve(region); regions.delete(table); continue }
      const overflow = region.scrollWidth > region.clientWidth + 1
      if (hint.hidden === overflow) hint.hidden = !overflow
      region.tabIndex = overflow ? 0 : -1
    }
  }
  const resize = new ResizeObserver(update)
  return {
    refresh (): void {
      for (const table of host.querySelectorAll('table')) {
        if (regions.has(table)) continue
        let region = table.parentElement!
        if (!region.matches('.table-scroll, .precision-table, .result-table-scroll')) {
          region = document.createElement('div'); table.before(region); region.append(table)
        }
        region.classList.add('result-table-scroll'); region.setAttribute('role', 'region')
        region.setAttribute('aria-label', table.caption?.textContent?.trim() || 'Result table')
        const hint = document.createElement('p'); hint.className = 'table-scroll-hint'; hint.dataset.runOwned = ''
        hint.textContent = 'More columns → scroll horizontally or focus the table and use the arrow keys.'
        hint.hidden = true; region.before(hint)
        regions.set(table, { region, hint }); resize.observe(region)
        for (const cell of table.querySelectorAll('thead th')) cell.setAttribute('scope', 'col')
        for (const cell of table.querySelectorAll('tbody th')) cell.setAttribute('scope', 'row')
      }
      update()
    },
    destroy (): void { resize.disconnect(); regions.clear() },
  }
}

export function presentDocumentTables (host: HTMLElement): void {
  documents.get(host)?.()
  const tables = createResultTables(host); tables.refresh()
  host.dataset.resultTables = ''; documents.set(host, tables.destroy)
}

export function disposeDocumentTables (root: HTMLElement): void {
  for (const host of [root, ...root.querySelectorAll<HTMLElement>('[data-result-tables]')]) {
    documents.get(host)?.(); documents.delete(host); delete host.dataset.resultTables
  }
}
