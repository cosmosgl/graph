import type { ExperimentInstance } from '../../runtime/experiment'
import { createPairedPickView } from './paired-pick-view'
import { runPointStyleUpdates, type PointStyleSample } from './point-style-updates'
import { createSelectionTable } from './selection-table'

function selectionTable (samples: readonly (Pick<PointStyleSample, 'selections' | 'requestedSize'> | undefined)[]): HTMLElement {
  const sample = samples.find(frame => frame !== undefined)
  if (!sample) return document.createElement('div')
  return createSelectionTable({
    description: `The requested diameter is ${sample.requestedSize} CSS px. Both regions start 24 CSS px wide, ` +
      'centered horizontally on point 0, and end below point 2. The lasso widens to 40 CSS px at the bottom.',
    locationHeading: 'Top edge from point 0',
    rows: sample.selections.map(({ offset }) => ({
      label: `${Math.abs(offset)} px ${offset < 0 ? 'above' : 'below'}`,
      selections: samples.map(frame => frame?.selections.find(probe => probe.offset === offset)),
    })),
  })
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
