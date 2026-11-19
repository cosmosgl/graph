import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'attractor-comparison',
  title: 'Compare per-point attraction',
  kind: 'compare',
  question: 'Do WebGL and WebGPU move points toward their own targets consistently?',
  description: 'The same 1,024 points move toward individual targets, with a CPU calculation as the reference.',
  tryIt: 'Press Step and check to advance once and compare forces and positions.',
  reference: 'Production WebGL attraction and an independent CPU calculation using the same targets and strengths.',
  acceptance: 'Force and position checks use the existing component tolerance; flags and disabled-stage positions must match exactly.',
  recorded: {
    conclusion: 'Both backends passed the recorded checks through 8,192 points. Corrected WebGPU cost more in isolated force timings.',
    date: '2026-11-18',
    environment: 'Apple M3, inline Chromium 157, luma 10.0.0-alpha.15.',
    scope: 'Nine isolated inputs with sampled trajectories and target updates.',
    limits: 'Combined-force cost, long cooling runs and production setter behavior were not established.',
    evidence: [{ label: 'Attraction comparison evidence', page: 'findings' }, { label: 'How per-point attraction works', page: 'method' }],
  },
}]
