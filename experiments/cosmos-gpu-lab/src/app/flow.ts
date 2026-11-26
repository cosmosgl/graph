/** Plain-text stages: one row per step, ` · ` for detail, ` | ` for sibling paths. */
export function renderFlow (source: string, horizontal: boolean, escape: (text: string) => string): string {
  const rows = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map(line => line.split(' | ').map(label => label.trim()))
  const stage = (label: string): string => {
    const separator = label.indexOf(' · ')
    const title = separator < 0 ? label : label.slice(0, separator)
    const detail = separator < 0 ? '' : label.slice(separator + 3)
    const description = detail ? ` <span class="flow-detail">${escape(detail)}</span>` : ''
    return `<span class="flow-title">${escape(title)}</span>${description}`
  }
  const items = rows.map((row, index) => {
    if (row.length === 1) return `<li class="flow-step">${stage(row[0])}</li>`
    const terminal = index === rows.length - 1 ? ' flow-fork-terminal' : ''
    const branches = row.map(label => `<li>${stage(label)}</li>`).join('')
    return `<li class="flow-fork${terminal}"><ul class="flow-branches" role="list">${branches}</ul></li>`
  }).join('')
  const layout = horizontal && rows.every(row => row.length === 1) ? ' flow-row' : ''
  return `<ol class="doc-flow${layout}" role="list">${items}</ol>`
}
