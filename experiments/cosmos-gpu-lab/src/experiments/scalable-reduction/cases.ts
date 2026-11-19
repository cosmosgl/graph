import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'reduce-center',
  title: 'Calculate a center at scale',
  kind: 'compare',
  question: 'Can the GPU calculate the center of a large point set?',
  description: 'A hierarchy of GPU reductions computes the average position; the view displays a sample of the moving points.',
  tryIt: 'Start with 8,192 points and press Step. Compare the GPU center with the CPU reference error.',
  reference: 'The CPU center of the initial points, adjusted by an idealized rotation for later ticks.',
  acceptance: 'Inspect the reported center and error; the idealized rotation is not a per-point float32 trajectory check.',
  recorded: {
    conclusion: 'Four exploratory presets produced finite centers, including ten million GPU-resident points.',
    date: '5 November 2026',
    environment: 'macOS Chromium; exact GPU and browser version were not recorded. luma 10.0.0-alpha.4.',
    scope: '8,192 to ten million points, using GPU-generated positions and a capped visual preview.',
    limits: 'The ten-million-point CPU reference was skipped. This exploratory run does not establish portable accuracy or layout performance.',
    evidence: [{ label: 'Reduction findings', page: 'results' }, { label: 'How the reduction works', page: 'algorithm' }],
  },
}]
