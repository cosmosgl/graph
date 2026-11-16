import MarkdownIt from 'markdown-it'
import source from '../docs/feature-inventory.md?raw'
import { findExperiment } from './registry'
import { research } from './research'
import { headingSlug } from './sections'
import { experimentHref } from './router'
export type Coverage = { id: string; name: string; group: string; status: 'Covered in isolation' | 'Partial' | 'Needs validation'; experiments: string[] }
export function parseCoverage (text: string): Coverage[] {
  const tokens = new MarkdownIt({ html: false }).parse(text, {}); const rows: Coverage[] = []
  let group = ''; let cells: string[] | undefined
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'heading_open' && tokens[i].tag === 'h2') group = tokens[i + 1].content
    if (tokens[i].type === 'tr_open') cells = []
    if (cells && tokens[i].type === 'td_open') cells.push(tokens[i + 1].content)
    if (tokens[i].type !== 'tr_close' || !cells || !cells[0]?.startsWith('**')) continue
    const status = /^\*\*Covered/.test(cells[2])
      ? 'Covered in isolation'
      : /^\*\*Partial/.test(cells[2])
        ? 'Partial'
        : /^\*\*Needs validation/.test(cells[2]) ? 'Needs validation' : undefined
    if (!status) throw new Error(`Unclassified inventory feature: ${cells[0]}`)
    const name = /^\*\*([^*]+)\*\*/.exec(cells[0])![1]
    const experiments = [...new Set(Array.from(cells[2].matchAll(/\]\(#\/([^/?#)]+)/g), m => m[1]).filter(id => !!findExperiment(id)))]
    rows.push({ id: `feature-${headingSlug(name)}`, name, group: group.replace(/^\d+\. /, ''), status, experiments })
    cells = undefined
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate feature inventory IDs')
  return rows
}
export const coverage = parseCoverage(source)
export function renderCoverageSummary (host: HTMLElement): void {
  host.innerHTML = `<p class="coverage-summary">${(['Covered in isolation', 'Partial', 'Needs validation'] as const)
    .map(status => `<span><strong>${coverage.filter(row => row.status === status).length}</strong> ${status.toLowerCase()}</span>`).join(' · ')}
    · ${coverage.length} feature rows</p><p class="research-meta">Bounded coverage, not a completion percentage or production approval.
      “Covered” retains the limits and counterexamples in the detailed inventory.</p>`
}
export function renderCoverageIndex (host: HTMLElement): void {
  host.innerHTML = '<h2>Feature coverage</h2><div data-coverage-summary></div>'
  host.insertAdjacentHTML('beforeend', '<p class="research-meta">Related studies can contain rejected alternatives; feature links open the full scope.</p>')
  renderCoverageSummary(host.querySelector('[data-coverage-summary]')!)
  for (const group of [...new Set(coverage.map(row => row.group))]) {
    const section = document.createElement('section'); section.className = 'coverage-group readiness-table'
    section.innerHTML = `<h3>${group}</h3><table><thead><tr><th>Feature</th><th>Coverage</th><th>Related methods and evidence</th></tr></thead><tbody>
      ${coverage.filter(row => row.group === group).map(row => `<tr><th><a href="#/feature-inventory?section=${row.id}">${row.name}</a></th>
      <td>${row.status}</td><td>${row.experiments.length
  ? row.experiments.map(id => {
    const title = research[id].methods?.find(method => method.verdict === 'Method under test')?.title ?? findExperiment(id)!.title
    return `<a href="${experimentHref(id)}">${title}</a>`
  })
    .join(' · ')
  : row.status === 'Needs validation' ? 'No validating experiment yet' : 'See detailed scope'}</td></tr>`).join('')}</tbody></table>`
    host.append(section)
  }
  host.insertAdjacentHTML('beforeend', '<p><a href="#/feature-inventory">' +
    'Full methods, production behavior, counterexamples and remaining validation →</a></p>')
}
export function markCoverageRows (host: HTMLElement): void {
  for (const row of host.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
    const name = row.cells[0]?.querySelector('strong')?.textContent
    const feature = coverage.find(feature => feature.name === name)
    if (feature) row.id = feature.id
  }
}
