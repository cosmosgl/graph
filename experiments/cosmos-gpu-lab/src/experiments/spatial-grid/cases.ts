import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'build-grid',
  title: 'Build a spatial grid',
  kind: 'compare',
  question: 'Does the grid place every point in the correct cell exactly once?',
  description: 'Build a grid on the GPU and compare its counts, offsets and point membership with a CPU reference.',
  tryIt: 'Start with 100,000 uniformly distributed points and press Build + validate. The heatmap shows cell occupancy.',
  reference: 'An independent CPU histogram, exclusive scan and point-membership check.',
  acceptance: 'Counts, offsets and membership must match exactly. The order of points within a cell can differ.',
  recorded: null,
  evidence: [{ label: 'How validation works', page: 'validation' }, { label: 'Grid overview', page: 'overview' }],
}]
