import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'circle-comparison',
  title: 'Compare circle rendering',
  kind: 'demonstrate',
  question: 'How does WebGPU draw a circle using triangles?',
  description: 'WebGL draws one sprite per point. WebGPU builds a square from two triangles per point.',
  tryIt: 'Compare the two panels, then change the point diameter or regenerate the layout.',
  reference: 'Both panels receive the same positions, colors and circle diameter.',
  acceptance: 'Inspect the circle geometry visually. The point shapes and picking experiments check production pixels and IDs.',
  recorded: null,
  evidence: [
    { label: 'Where the circle edge comes from', page: 'case-method' },
    { label: 'Implementation', page: 'implementation' },
  ],
}]
