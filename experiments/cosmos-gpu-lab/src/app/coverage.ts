import MarkdownIt from 'markdown-it'
import source from '../docs/feature-inventory.md?raw'
import { roadmapHref } from './router'
import { headingSlug } from './sections'

const statuses = ['Covered in isolation', 'Partial', 'Needs validation'] as const
const markdown = new MarkdownIt({ html: false, typographer: true })
type Token = ReturnType<MarkdownIt['parse']>[number]
type Coverage = {
  id: string;
  name: string;
  group: string;
  status: typeof statuses[number];
  production: string;
  evidence: string;
  searchText: string;
}

export function parseCoverage (source: string): Coverage[] {
  const tokens = markdown.parse(source, {})
  const rows: Coverage[] = []
  let group = ''
  let cells: Token[] = []
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'heading_open' && token.tag === 'h2') group = tokens[index + 1].content
    if (token.type === 'tr_open') cells = []
    if (token.type === 'td_open') cells.push(tokens[index + 1])
    if (token.type !== 'tr_close' || !cells.length) continue

    const [feature, production, verdict, evidence] = cells
    const name = /^\*\*([^*]+)\*\*/.exec(feature.content)?.[1]
    const status = statuses.find(status => status === verdict?.content)
    if (!group || !name || !status || !production?.content || !evidence?.content) {
      throw new Error(`Incomplete or unclassified inventory feature: ${feature.content}`)
    }
    const render = (cell: Token): string => markdown.renderer.renderInline(cell.children ?? [], markdown.options, {})
    const searchText = cells.flatMap(cell => cell.children ?? [])
      .filter(child => child.type === 'text' || child.type === 'code_inline')
      .map(child => child.content).join(' ')
    rows.push({
      id: `feature-${headingSlug(name)}`,
      name,
      group,
      status,
      production: render(production),
      evidence: render(evidence),
      searchText,
    })
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate feature inventory IDs')
  return rows
}

export const coverage = parseCoverage(source)

export function renderCoverage (host: HTMLElement): void {
  const escape = markdown.utils.escapeHtml
  const groups = Array.from(new Set(coverage.map(row => row.group)), name => ({
    name: escape(name),
    id: `coverage-${headingSlug(name)}`,
    rows: coverage.filter(row => row.group === name),
  }))
  const counts = statuses.map(status => {
    const count = coverage.filter(row => row.status === status).length
    const label = status === 'Needs validation' && count !== 1 ? 'need validation' : status.toLowerCase()
    return `<span><strong>${count}</strong> ${label}</span>`
  }).join(' · ')
  host.innerHTML = `<div class="coverage-overview">
    <p class="coverage-summary" id="coverage-summary">${counts}</p>
    <nav class="migration-jumps" aria-label="Coverage groups">${groups.map(group =>
    `<a href="${roadmapHref(group.id)}">${group.name} <span>${group.rows.length}</span></a>`).join('')}</nav>
  </div>`

  for (const group of groups) {
    const section = document.createElement('section')
    section.className = 'coverage-group'
    section.setAttribute('aria-labelledby', group.id)
    section.innerHTML = `<h3 id="${group.id}">${group.name}</h3>
      <ul class="coverage-rows" role="list">${group.rows.map(row => `<li class="coverage-feature" id="${row.id}">
        <div class="coverage-feature-header">
          <h4>${escape(row.name)}</h4>
          <span class="coverage-status" data-status="${row.status}">${row.status}</span>
        </div>
        <p class="coverage-evidence">${row.evidence}</p>
        <p class="coverage-baseline"><strong>Production WebGL</strong> · ${row.production}</p>
      </li>`).join('')}</ul>`
    if (group.id === 'coverage-simulation') {
      section.insertAdjacentHTML('beforeend', `<aside class="coverage-force-order" aria-labelledby="force-order-is-part-of-the-behavior">
        <h4 id="force-order-is-part-of-the-behavior">Force order</h4>
        <p>Each enabled force uses the positions left by the previous one. A tick runs optional mouse
        repulsion, then gravity, center, many-body repulsion, incoming springs, outgoing springs, cluster attraction, per-point
        attractors and the configured collision passes before cooling. Mouse repulsion can also run while simulation is paused.</p>
      </aside>`)
    }
    host.append(section)
  }
  host.insertAdjacentHTML('beforeend', `<section class="coverage-guide" aria-labelledby="how-to-read-coverage">
    <h3 id="how-to-read-coverage">How coverage is assessed</h3>
    <dl>
      <div><dt>Covered in isolation</dt><dd>An experiment implements and checks the feature under the listed conditions.</dd></div>
      <div><dt>Partial</dt><dd>Some behavior has been demonstrated. The row identifies what still needs a check.</dd></div>
      <div><dt>Needs validation</dt><dd>The production behavior still needs a WebGPU implementation and a comparison.</dd></div>
    </dl>
    <p>Coverage describes the tested inputs and devices. Production approval also requires the features to work together.</p>
  </section>`)
}
