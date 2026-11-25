import type { ExperimentInstance } from '../../runtime/experiment'
import { createPairedPickView } from './paired-pick-view'
import { runSparseTransition } from './sparse-transition'

const phases = new Map([
  ['initial', 'Before removal'],
  ['remove', 'Removal'],
  ['restore', 'Restoration'],
  ['snap-remove', 'Immediate removal'],
  ['snap-restore', 'Immediate restoration'],
])

export function createSparseView (host: HTMLElement): ExperimentInstance {
  return createPairedPickView(host, {
    probes: { point: 'Edited point', link: 'Incident link', anchor: 'Other endpoint', control: 'Isolated point' },
    initial: 'remove-500',
    run: async (engine, ratio) => (await runSparseTransition(engine, ratio)).samples.map(({ phase, time, pixels, picks }) => ({
      key: `${phase}-${time}`,
      title: phase === 'remove' || phase === 'restore' ? `${phases.get(phase)} · ${time} ms` : phases.get(phase)!,
      pixels,
      picks,
    })),
  })
}
