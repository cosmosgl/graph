type Selection = { rectangle: number[]; lasso: number[] }

export function createSelectionTable (options: {
  description: string;
  locationHeading: string;
  rows: { label: string; selections: (Selection | undefined)[] }[];
}): HTMLElement {
  const section = document.createElement('section')
  section.className = 'paired-area-selections'
  section.innerHTML = `<h3>Selected point IDs</h3><p></p><table>
    <caption>${options.rows.length} rectangles and ${options.rows.length} lassos per package</caption>
    <colgroup></colgroup><colgroup span="2"></colgroup><colgroup span="2"></colgroup>
    <thead><tr><th rowspan="2" scope="col"></th><th colspan="2" scope="colgroup">Rectangle</th>
    <th colspan="2" scope="colgroup">Lasso</th></tr>
    <tr><th scope="col">WebGL</th><th scope="col">WebGPU</th><th scope="col">WebGL</th><th scope="col">WebGPU</th></tr></thead>
    <tbody></tbody></table>`
  section.querySelector('p')!.textContent = options.description
  section.querySelector('th')!.textContent = options.locationHeading
  const body = section.querySelector('tbody')!
  for (const { label, selections } of options.rows) {
    const row = body.insertRow()
    const heading = document.createElement('th')
    heading.scope = 'row'
    heading.textContent = label
    row.append(heading)
    for (const shape of ['rectangle', 'lasso'] as const) {
      for (const selection of selections) row.insertCell().textContent = selection ? `[${selection[shape].join(', ')}]` : '—'
    }
  }
  return section
}
