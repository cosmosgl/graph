import type { ExperimentCase } from '../../runtime/experiment'

export const gridEnvironment = 'Chrome 157 · webgpu: apple'

export const cases: ExperimentCase[] = [{
  id: 'build-grid',
  title: 'Build a spatial grid',
  kind: 'compare',
  question: 'Does the grid place every point in the correct cell exactly once?',
  description: 'Build a grid on the GPU and compare its counts, offsets and point membership with a CPU reference.',
  tryIt: 'Choose a distribution to rebuild the grid and inspect where points concentrate.',
  reference: 'An independent CPU histogram, exclusive scan and point-membership check.',
  acceptance: 'Counts, offsets and membership must match exactly. The order of points within a cell can differ.',
  recorded: {
    conclusion: 'All cell counts, ranges and point memberships matched the CPU reference in three fixtures.',
    date: '2026-11-23',
    environment: gridEnvironment,
    scope: 'Four builds, including a three-level scan rebuilt in place and five million clustered points.',
    limits: 'Other adapters, force accuracy and complete layout performance remain open.',
    evidence: [{ label: 'Automated test results', page: 'validation' }],
  },
}]
