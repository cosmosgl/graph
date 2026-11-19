import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'weighted-springs',
  title: 'Compare weighted link forces',
  kind: 'compare',
  question: 'Do WebGL and WebGPU apply the same weighted spring forces?',
  description: 'Both backends update the same graph, then compare their ordered spring steps with a CPU model.',
  tryIt: 'Start with the 128-point star and select Step + validate. Compare the panels and the force checks.',
  reference: 'Independent CPU edge lists and a float32 compatibility model check each directional spring and integration step.',
  acceptance: 'The existing force and substep tolerances apply; topology and pinning checks are reported separately.',
  recorded: {
    conclusion: 'The 128-point star passed ten ticks on both GPU backends. Later 100,000-point WebGL checks passed after an earlier ' +
      'direct-path run lost its context.',
    date: '9 and 19 November 2026',
    environment: 'Apple M3, ANGLE Metal WebGL and Apple WebGPU.',
    scope: 'Weighted springs on bounded fixtures, including a 128-point star and two 100,000-point WebGL runs.',
    limits: 'The earlier reset remains unexplained. These checks do not establish large-graph speedups or complete engine readiness.',
    evidence: [{ label: 'Weighted spring evidence', page: 'case-evidence' }],
  },
}]
