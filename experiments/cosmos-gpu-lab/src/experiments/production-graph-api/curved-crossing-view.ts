import type { ExperimentInstance } from '../../runtime/experiment'
import { runCurvedCrossing } from './curved-crossing'
import { createPairedPickView } from './paired-pick-view'

const titles = { before: 'Before crossing', during: 'At the crossing', after: 'After crossing' }

export function createCurvedCrossingView (host: HTMLElement): ExperimentInstance {
  return createPairedPickView(host, {
    initial: 'during',
    probes: {
      point: 'Point center (128, 80)',
      linkOnly: 'Same center with point 2 omitted',
      witness: 'Beside the point (160, 83)',
      stroke: 'On the moving curve',
      background: 'Empty space (16, 16)',
    },
    run: async (engine, ratio) => (await runCurvedCrossing(engine, ratio)).samples.map(sample => ({
      key: sample.phase,
      title: `${titles[sample.phase]} · ${sample.time} ms`,
      pixels: sample.pixels,
      picks: { ...sample.picks, linkOnly: sample.linkOnly.pick },
      detail: `Center RGB (${sample.colors.point.join(', ')}), or (${sample.linkOnly.rgb.join(', ')}) with point 2 omitted. ` +
        `Moving curve probe (80, ${sample.strokeY}).`,
    })),
  })
}
