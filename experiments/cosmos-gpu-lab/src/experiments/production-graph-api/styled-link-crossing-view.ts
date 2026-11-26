import type { ExperimentInstance } from '../../runtime/experiment'
import { createPairedPickView } from './paired-pick-view'
import { runStyledLinkCrossing, styledLinkProbes } from './styled-link-crossing'

const sites = {
  crossing: 'Crossing',
  horizontal: 'Horizontal path · same dash phase',
  opposite: 'Horizontal path · opposite phase',
  vertical: 'Vertical stroke',
  background: 'Empty space',
}

/* eslint-disable @typescript-eslint/naming-convention -- Keys identify the recorded link orders. */
const orders = {
  'solid-dashed': 'Solid 0 first, dashed 1 last',
  'dashed-solid': 'Dashed 0 first, solid 1 last',
  'solid-only': 'Solid 0 alone',
  'dashed-only': 'Dashed 0 alone',
}
/* eslint-enable @typescript-eslint/naming-convention */

export function createStyledLinkCrossingView (host: HTMLElement): ExperimentInstance {
  return createPairedPickView(host, {
    initial: 'dash-solid-dashed',
    caption: 'Click ID and pixel RGB at each location',
    probes: Object.fromEntries(styledLinkProbes.map(({ key, x, y }) => [key, `${sites[key]} (${x}, ${y})`])),
    run: async (engine, ratio) => (await runStyledLinkCrossing(engine, ratio)).samples.map(({ phase, order, pixels, sites: measured }) => ({
      key: `${phase}-${order}`,
      title: `${phase === 'dash' ? 'Dash' : 'Gap'} at crossing · ${orders[order]}`,
      pixels,
      picks: Object.fromEntries(styledLinkProbes.map(({ key }) => [key, `${measured[key].pick} · (${measured[key].rgb.join(', ')})`])),
    })),
  })
}
