import type { ExperimentCase } from '../../runtime/experiment'

export const selectionEnvironmentLabel = 'Chrome 157 · M3'

export const selectionCase = {
  id: 'shape-selection',
  title: 'Select points with shapes',
  kind: 'compare',
  question: 'Does WebGPU select the same points as WebGL v3.6.0 along the edge of a selection?',
  description: 'The WebGL and WebGPU previews each highlight the points they select inside or along the edge of the same shape.',
  reference: 'Each drag compares the WebGPU result with the v3.6.0 WebGL selection shaders. The recorded checks also use an independent CPU reference.',
  acceptance: 'WebGL and WebGPU must select the same point IDs for the same shape.',
  recorded: {
    conclusion: 'WebGL and WebGPU returned the same ordered point IDs as the CPU reference in all 19 isolated cases.',
    date: '2026-11-19',
    environment: `${selectionEnvironmentLabel} (Metal)`,
    scope: 'WebGL v3.6.0 rules, including a 2,048-edge cutoff, tested on stationary points with pan and zoom. ' +
      'An empty point set and a two-vertex lasso returned before GPU dispatch.',
    limits: 'This study preserves the v3.6.0 center-only lasso. The packaged Graph replay measures the current touch and center modes.',
    evidence: [{ label: 'Automated test results', page: 'automated-cases' }],
  },
} satisfies ExperimentCase
