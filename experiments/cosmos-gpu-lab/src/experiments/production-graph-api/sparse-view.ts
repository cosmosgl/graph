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
  ['snap-remove', 'Immediate removal'],
  ['snap-restore', 'Immediate restoration'],
])

const regionLabels = { old: 'Original (48)', midpoint: 'Midpoint (64)', destination: 'First target (80)', all: 'All points' }
const locationLabels = { old: 'Original (48, 96)', midpoint: 'Midpoint (64, 96)', destination: 'First target (80, 96)' }
const previews: Record<SparseScenario, { initial: string; locations: Record<string, string> }> = {
  complete: { initial: 'remove-500', locations: { point: 'Edited point' } },
  interrupted: { initial: 'restore-0', locations: { old: locationLabels.old, destination: locationLabels.destination } },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Match the replay's scenario name.
  'remove-again': { initial: 'remove-again-0', locations: locationLabels },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Match the replay's scenario name.
  'restore-original': { initial: 'restore-original-0', locations: locationLabels },
}

function selectionTable (samples: readonly (SparseSample['selections'] | undefined)[]): HTMLElement {
  const regions = samples.find(sample => sample !== undefined)
  if (!regions) return document.createElement('div')
  return createSelectionTable({
    description: 'The original position and first target are 32 CSS px apart. The three small regions lie at y = 96 CSS px. ' +
      'Each uses a 4 × 4 CSS px rectangle and a diamond lasso of the same width and height. The large region includes both other points.',
    locationHeading: 'Region (x in CSS px)',
    rows: regions.map(({ region }) => ({
      label: regionLabels[region],
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
  const { initial, locations } = previews[scenario]
  return createPairedPickView(host, {
    probes: { ...locations, link: 'Incident link', anchor: 'Other endpoint', control: 'Isolated point' },
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
        if ((scenario === 'remove-again' || scenario === 'restore-original') && phase === 'restore' && time === 500) title += ' · Before removal'
        if (scenario === 'restore-original' && phase === 'remove-again' && time === 500) title = 'Before final return · 500 ms'
        const colors: string[] = []
        for (const [location, label] of [['old', 'original'], ['midpoint', 'midpoint'], ['destination', 'first target']] as const) {
          const site = sites[location]
          if (!site) continue
          picks[location] = site.pick
          colors.push(`${label} (${site.rgb.join(', ')})`)
        }
        detail += ` · RGB at ${colors.join(', ')} and link (${sample.linkRgb.join(', ')})`
      }
      return { key: `${phase}-${time}`, title, pixels: sample.pixels, picks, results: sample.selections, detail }
    }),
    renderResults: selectionTable,
  })
}
