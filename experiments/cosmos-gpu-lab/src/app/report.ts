import type { ExperimentReport } from '../runtime/experiment'

function heading (tag: 'h2' | 'h3', text: string): HTMLHeadingElement {
  const element = document.createElement(tag)
  element.textContent = text
  return element
}

function paragraph (text: string): HTMLParagraphElement {
  const element = document.createElement('p')
  element.className = 'report-meta'
  element.textContent = text
  return element
}

function cell (text: string, tag: 'th' | 'td'): HTMLTableCellElement {
  const element = document.createElement(tag)
  element.textContent = text
  return element
}

function keyValueTable (values: Record<string, string | number>): HTMLTableElement {
  const table = document.createElement('table')
  const body = document.createElement('tbody')
  for (const [key, value] of Object.entries(values)) {
    const row = document.createElement('tr')
    row.append(cell(key, 'th'), cell(String(value), 'td'))
    body.append(row)
  }
  table.append(body)
  return table
}

function resultsTable (report: ExperimentReport): HTMLTableElement {
  const keys = [...new Set(report.results.flatMap(result => Object.keys(result.values)))]
  const table = document.createElement('table')
  const headRow = document.createElement('tr')
  headRow.append(cell('Backend', 'th'), ...keys.map(key => cell(key, 'th')))
  const head = document.createElement('thead')
  head.append(headRow)

  const body = document.createElement('tbody')
  for (const result of report.results) {
    const row = document.createElement('tr')
    row.append(
      cell(result.backend, 'th'),
      ...keys.map(key => cell(String(result.values[key] ?? '—'), 'td'))
    )
    body.append(row)
  }
  table.append(head, body)
  return table
}

function list (items: string[]): HTMLUListElement {
  const element = document.createElement('ul')
  for (const item of items) {
    const listItem = document.createElement('li')
    listItem.textContent = item
    element.append(listItem)
  }
  return element
}

export function renderReport (
  host: HTMLElement,
  report: ExperimentReport,
  expectedExperiment: string
): void {
  if (report.schemaVersion !== 1) {
    throw new Error(`Unsupported report schema: ${report.schemaVersion}`)
  }
  if (report.experiment !== expectedExperiment) {
    throw new Error(`Report ${report.experiment} does not belong to ${expectedExperiment}`)
  }

  host.replaceChildren()
  const article = document.createElement('article')
  article.className = 'report prose'

  article.append(
    heading('h2', report.title),
    paragraph(`${report.status} · recorded ${report.recordedAt} · commit ${report.commit}`),
    heading('h3', 'Environment'),
    keyValueTable(report.environment),
    heading('h3', 'Parameters'),
    keyValueTable(report.parameters),
    heading('h3', 'Results'),
    resultsTable(report),
    heading('h3', 'Interpretation'),
    list(report.notes)
  )

  host.append(article)
}
