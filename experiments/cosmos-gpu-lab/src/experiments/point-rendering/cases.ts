import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'circle-comparison',
  title: 'Compare circle rendering',
  kind: 'demonstrate',
  question: 'How do WebGL and WebGPU draw the same circles?',
  description: 'The two panels draw the same 1,024 points: WebGL uses point sprites and WebGPU uses quads.',
  tryIt: 'Compare the two panels, then change the point diameter or regenerate the layout.',
  reference: 'Both panels receive the same positions, colors and circle diameter.',
  acceptance: 'This is a visual comparison; it does not calculate pixel differences or test picking.',
  recorded: null,
  evidence: [{ label: 'How the comparison works', page: 'case-method' }],
}]
