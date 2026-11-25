import type { ExperimentInstance } from '../../runtime/experiment'
import { createPairedPickView } from './paired-pick-view'
import { createSelectionTable } from './selection-table'
import { runSparseTransition, type SparseSample } from './sparse-transition'

const phases = new Map([
  ['initial', 'Before removal'],
  ['remove', 'Removal'],
  ['restore', 'Restoration'],
  ['snap-remove', 'Immediate removal'],
  ['snap-restore', 'Immediate restoration'],
])

const regionLabels = { old: 'Old (48)', midpoint: 'Midpoint (64)', destination: 'New (80)', all: 'All points' }

function selectionTable (samples: readonly (SparseSample['selections'] | undefined)[]): HTMLElement {
  const regions = samples.find(sample => sample !== undefined)
  if (!regions) return document.createElement('div')
  return createSelectionTable({
    description: 'Point 1 returns 32 CSS px to the right. The three small regions lie at y = 96 CSS px. ' +
      'Each uses a 4 × 4 CSS px rectangle and a diamond lasso of the same width and height. The large region includes both other points.',
    locationHeading: 'Region (x in CSS px)',
    rows: regions.map(({ region }) => ({
      label: regionLabels[region],
      selections: samples.map(sample => sample?.find(probe => probe.region === region)),
    })),
  })
}

function describePoint (bounds: SparseSample['pointBounds'], ratio: number): string {
  if (!bounds) return 'Point 1 has no visible pixels.'
  const center = (bounds[0]! + bounds[2]!) / (2 * ratio)
  const width = (bounds[2]! - bounds[0]!) / ratio
  return `Point 1 painted center x = ${center} CSS px · width ${width} CSS px`
}

export function createSparseView (host: HTMLElement): ExperimentInstance {
  return createPairedPickView(host, {
    probes: { point: 'Edited point', link: 'Incident link', anchor: 'Other endpoint', control: 'Isolated point' },
    initial: 'remove-500',
    run: async (engine, ratio) => (await runSparseTransition(engine, ratio)).samples.map(sample => ({
      key: `${sample.phase}-${sample.time}`,
      title: sample.phase === 'remove' || sample.phase === 'restore' ? `${phases.get(sample.phase)} · ${sample.time} ms` : phases.get(sample.phase)!,
      pixels: sample.pixels,
      picks: sample.picks,
      results: sample.selections,
      detail: describePoint(sample.pointBounds, ratio),
    })),
    renderResults: selectionTable,
  })
}
