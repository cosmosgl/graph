import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'cluster-comparison',
  title: 'Compare cluster attraction',
  kind: 'compare',
  question: 'Do WebGL and WebGPU move groups toward the same centers?',
  description: 'Each group in the same 1,024-point input moves toward its own center; a CPU calculation provides a reference.',
  tryIt: 'Press Step and check to advance once and compare group sums, forces and positions.',
  reference: 'Production WebGL cluster attraction and an independent CPU calculation of group centers and forces.',
  acceptance: 'The existing component tolerance applies to forces and positions; group counts and flags must match exactly.',
  recorded: {
    conclusion: 'Both backends passed all 45 recorded CPU comparison rows. WebGPU was faster for large uneven groups, but not every input.',
    date: '2026-11-18',
    environment: 'Apple M3, inline Chromium 157, luma 10.0.0-alpha.15.',
    scope: 'Nine isolated inputs through 8,192 points, including sampled trajectories and one membership or target update.',
    limits: 'Complete-frame cost, combined forces and production API behavior were not established.',
    evidence: [{ label: 'Cluster comparison evidence', page: 'findings' }, { label: 'How cluster attraction works', page: 'method' }],
  },
}]
