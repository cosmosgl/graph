import type { ExperimentCase } from '../../runtime/experiment'

export const selectionEnvironmentLabel = 'Chrome 157 · M3'

export const selectionCase = {
  id: 'shape-selection',
  title: 'Select points with shapes',
  kind: 'compare',
  question: 'Does WebGPU select the same points as WebGL along the edge of a selection?',
  description: 'The WebGL and WebGPU previews each highlight the points they select inside or along the edge of the same shape.',
  reference: 'Each drag compares the WebGPU result with the production WebGL selection shaders. The recorded checks also use an independent CPU reference.',
  acceptance: 'WebGL and WebGPU must select the same point IDs for the same shape.',
  recorded: {
    conclusion: 'WebGL and WebGPU returned the same ordered point IDs as the CPU reference in all 19 isolated cases.',
    date: '2026-11-19',
    environment: `${selectionEnvironmentLabel} (Metal)`,
    scope: 'Stationary points, including a 257-point scatterplot, with pan, zoom and lasso edge cases. ' +
      'An empty point set and a two-vertex lasso returned before GPU dispatch.',
    limits: 'Production WebGPU pointer handling, rounding near other edges and the cost of large moving selections remain open.',
    evidence: [{ label: 'Automated test results', page: 'automated-cases' }],
  },
} satisfies ExperimentCase
