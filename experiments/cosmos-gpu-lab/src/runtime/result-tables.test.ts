import { expect, it } from 'vitest'
import { createResultTables } from './result-tables'

it('gives live and static tables separate owners without duplicate scrolling hints', () => {
  const host = document.createElement('div'); document.body.append(host)
  host.innerHTML = `<div data-live><table><tr><td>Live value</td></tr></table></div>
    <div class="experiment-notes"><table><tr><td>Recorded value</td></tr></table></div>
    <div class="experiment-references"><table><tr><td>Reference value</td></tr></table></div>`
  const live = createResultTables(host, { exclude: '.experiment-notes, .experiment-references' })
  const documents = createResultTables(host, { only: '.experiment-notes, .experiment-references' })
  try {
    live.refresh(); documents.refresh(); live.refresh(); documents.refresh()
    expect(host.querySelectorAll('.table-scroll-hint')).toHaveLength(3)
    expect(host.querySelectorAll('.result-table-scroll')).toHaveLength(3)
    expect(Array.from(host.querySelectorAll('td'), cell => cell.textContent)).toEqual(['Live value', 'Recorded value', 'Reference value'])
  } finally { live.destroy(); documents.destroy(); host.remove() }
})
