import type { ExperimentCase } from '../../runtime/experiment'

export const selectionCase = {
  id: 'shape-selection',
  title: 'Select points with shapes',
  kind: 'compare',
  question: 'Does WebGPU select the same points as WebGL along the edge of a selection?',
  description: 'The WebGL and WebGPU previews each highlight the points they select inside or along the edge of the same shape.',
  reference: 'Each drag compares the WebGPU result with the production WebGL selection shaders. The recorded checks also use an independent CPU reference.',
  acceptance: 'WebGL and WebGPU must select the same point IDs for the same shape.',
  evidence: [{ label: 'Automated selection cases', page: 'automated-cases' }],
  recorded: null,
} satisfies ExperimentCase
