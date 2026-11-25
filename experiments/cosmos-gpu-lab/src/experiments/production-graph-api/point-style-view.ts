import type { ExperimentInstance } from '../../runtime/experiment'
import { createPairedPickView } from './paired-pick-view'
import { runPointStyleUpdates } from './point-style-updates'

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
      detail: `Point size ${sample.size} CSS px · Point RGB (${sample.pointRgb.join(', ')}) · Link RGB (${sample.linkRgb.join(', ')})`,
    })),
  })
}
