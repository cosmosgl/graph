import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'reduce-center',
  title: 'Calculate a center at scale',
  kind: 'compare',
  question: 'Can the GPU calculate the center of a large point set?',
  description: 'A hierarchy of GPU reductions computes the average position; the view displays a sample of the moving points.',
  tryIt: 'Start with 8,192 points and press Step. Compare the GPU center with the CPU reference error.',
  reference: 'The CPU center of the initial points, adjusted by an idealized rotation for later ticks.',
  acceptance: 'Each readback checks the exact point count and finite center coordinates. The CPU error measures deviation from the ideal center.',
  recorded: {
    conclusion: 'WebGPU counted every point and matched the CPU center within the tested tolerance at 65,537 and ten million points.',
    date: '2026-11-23',
    environment: 'Chrome 157 · Apple WebGPU adapter',
    scope: 'GPU-generated positions at initialization and after one GPU-resident rotation.',
    limits: 'Long trajectories, other adapters and complete layout performance remain open.',
    evidence: [{ label: 'Reduction findings', page: 'results' }],
  },
}]
