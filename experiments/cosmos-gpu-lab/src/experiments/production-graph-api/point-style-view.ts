import type { ExperimentInstance } from '../../runtime/experiment'
import { createPairedPickView } from './paired-pick-view'
import { runPointStyleUpdates, type PointStyleSample } from './point-style-updates'

function selectionTable (samples: readonly (Pick<PointStyleSample, 'selections' | 'requestedSize'> | undefined)[]): HTMLElement {
  const section = document.createElement('section')
  const sample = samples.find(frame => frame !== undefined)
  if (!sample) return section
  section.className = 'point-style-selections'
  section.innerHTML = `<h3>Selected point IDs</h3>
    <p>The requested diameter is ${sample.requestedSize} CSS px. Both regions start 24 CSS px wide,
    centered horizontally on point 0, and end below point 2. The lasso widens to 40 CSS px at the bottom.</p>
    <table><caption>${sample.selections.length} rectangles and ${sample.selections.length} lassos per package</caption>
    <colgroup></colgroup><colgroup span="2"></colgroup><colgroup span="2"></colgroup>
    <thead><tr><th rowspan="2" scope="col">Top edge from point 0</th><th colspan="2" scope="colgroup">Rectangle</th>
    <th colspan="2" scope="colgroup">Lasso</th></tr>
    <tr><th scope="col">WebGL</th><th scope="col">WebGPU</th><th scope="col">WebGL</th><th scope="col">WebGPU</th></tr></thead>
    <tbody></tbody></table>`
  const body = section.querySelector('tbody')!
  for (const { offset } of sample.selections) {
    const row = body.insertRow()
    const heading = document.createElement('th')
    heading.scope = 'row'
    heading.textContent = `${Math.abs(offset)} px ${offset < 0 ? 'above' : 'below'}`
    row.append(heading)
    const selections = samples.map(frame => frame?.selections.find(probe => probe.offset === offset))
    for (const shape of ['rectangle', 'lasso'] as const) {
      for (const selection of selections) row.insertCell().textContent = selection ? `[${selection[shape].join(', ')}]` : '—'
    }
  }
  return section
}

export function createPointStyleView (host: HTMLElement): ExperimentInstance {
  return createPairedPickView(host, {
    initial: 'Interrupt with a larger white point',
    probes: {
      center: 'Point 0 center',
      edge: '20 CSS px below point 0',
      outerEdge: '22 CSS px below point 0',
      link: 'Link 0 midpoint',
      control: 'Point 2 center',
    },
    run: async (engine, ratio) => (await runPointStyleUpdates(engine, ratio)).samples.map(sample => ({
      key: sample.phase,
      title: sample.phase,
      pixels: sample.pixels,
      picks: sample.picks,
      results: sample,
      detail: `Painted diameter ${sample.pointSpan / ratio} CSS px · Point RGB (${sample.pointRgb.join(', ')}) · Link RGB (${sample.linkRgb.join(', ')})`,
    })),
    renderResults: selectionTable,
  })
}
