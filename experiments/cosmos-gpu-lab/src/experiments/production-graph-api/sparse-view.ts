import type { ExperimentInstance } from '../../runtime/experiment'
import { createPairedPickView } from './paired-pick-view'
import { createSelectionTable } from './selection-table'
import { runSparseTransition, type SparseSample, type SparseScenario } from './sparse-transition'

const phases = new Map([
  ['initial', 'Before removal'],
  ['remove', 'Removal'],
  ['restore', 'Restoration'],
  ['remove-again', 'Second removal'],
  ['restore-original', 'Final return'],
  ['remove-on-return', 'Third removal'],
  ['snap-remove', 'Immediate removal'],
  ['snap-restore', 'Immediate restoration'],
])

const locations = {
  old: { name: 'Original', x: 48 },
  returnMidpoint: { name: 'Halfway back', x: 56 },
  midpoint: { name: 'Midpoint', x: 64 },
  destination: { name: 'First target', x: 80 },
}
type Site = keyof typeof locations
const threeSites = ['old', 'midpoint', 'destination'] as const
const previews: Record<SparseScenario, { initial: string; sites: readonly Site[] }> = {
  complete: { initial: 'remove-500', sites: [] },
  interrupted: { initial: 'restore-0', sites: ['old', 'destination'] },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Match the replay's scenario name.
  'remove-again': { initial: 'remove-again-0', sites: threeSites },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Match the replay's scenario name.
  'restore-original': { initial: 'restore-original-0', sites: threeSites },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Match the replay's scenario name.
  'remove-on-return': { initial: 'remove-on-return-0', sites: ['old', 'returnMidpoint', 'midpoint', 'destination'] },
}

function selectionTable (samples: readonly (SparseSample['selections'] | undefined)[]): HTMLElement {
  const regions = samples.find(sample => sample !== undefined)
  if (!regions) return document.createElement('div')
  return createSelectionTable({
    description: 'Each local region is centered at y = 96 CSS px and uses a 4 × 4 CSS px rectangle and a diamond lasso of the same width and height. ' +
      'The large region includes both other points.',
    locationHeading: 'Region (x in CSS px)',
    rows: regions.map(({ region }) => ({
      label: region === 'all' ? 'All points' : `${locations[region].name} (${locations[region].x})`,
      selections: samples.map(sample => sample?.find(probe => probe.region === region)),
    })),
  })
}

function describePoint (bounds: SparseSample['pointBounds'], ratio: number): string {
  if (!bounds) return 'Point 1 has no visible pixels'
  const center = (bounds[0]! + bounds[2]!) / (2 * ratio)
  const width = (bounds[2]! - bounds[0]!) / ratio
  return `Point 1 painted center x = ${center} CSS px · width ${width} CSS px`
}

export function createSparseView (host: HTMLElement, scenario: SparseScenario = 'complete'): ExperimentInstance {
  const { initial, sites: probeSites } = previews[scenario]
  const siteProbes = Object.fromEntries(probeSites.map(site => [site, `${locations[site].name} (${locations[site].x}, 96)`]))
  if (scenario === 'complete') siteProbes.point = 'Edited point'
  return createPairedPickView(host, {
    probes: { ...siteProbes, link: 'Incident link', anchor: 'Other endpoint', control: 'Isolated point' },
    initial,
    run: async (engine, ratio) => (await runSparseTransition(engine, ratio, scenario)).samples.map(sample => {
      const { phase, time, sites } = sample
      let title = phases.get(phase)!
      if (phase !== 'initial' && !phase.startsWith('snap-')) title += ` · ${time} ms`
      const picks: Record<string, string> = { ...sample.picks }
      let detail = describePoint(sample.pointBounds, ratio)
      if (sites) {
        if (phase === 'remove' && time === 500) title += ' · Before interruption'
        if (phase === 'restore' && time === 0) title += ' · After interruption'
        if (scenario !== 'interrupted' && phase === 'restore' && time === 500) title += ' · Before removal'
        if (scenario !== 'remove-again' && phase === 'remove-again' && time === 500) title = 'Before final return · 500 ms'
        if (scenario === 'remove-on-return' && phase === 'restore-original' && time === 500) title = 'Before third removal · 500 ms'
        const colors: string[] = []
        for (const location of probeSites) {
          const site = sites[location]
          if (!site) continue
          picks[location] = site.pick
          colors.push(`${locations[location].name.toLowerCase()} (${site.rgb.join(', ')})`)
        }
        detail += ` · RGB at ${colors.join(', ')} and link (${sample.linkRgb.join(', ')})`
      }
      return { key: `${phase}-${time}`, title, pixels: sample.pixels, picks, results: sample.selections, detail }
    }),
    renderResults: selectionTable,
  })
}
