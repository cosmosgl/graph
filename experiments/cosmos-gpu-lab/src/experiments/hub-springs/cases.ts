import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'hub-cost',
  title: 'Compare hub spring calculations',
  kind: 'measure',
  question: 'Can sharing neighbor reads reduce the cost of a highly connected point?',
  description: 'Two WebGPU calculations process the same ordered links on an 8,192-point graph.',
  tryIt: 'Press Compare selected to measure the default unpinned hub and check the result. Keep this tab visible until it finishes.',
  reference: 'The plain ordered spring calculation, with separate CPU checks and trajectory controls.',
  acceptance: 'The original spring checks and exact replay must pass; timings describe only the selected device and workload.',
  recorded: {
    conclusion: 'The cooperative calculation passed the recorded trajectory gates and reduced time for large hubs; small-degree benefit varied.',
    date: 'Not recorded',
    environment: 'Apple M3, standalone Chrome 156, luma 10.0.0-alpha.4.',
    scope: '8,192-point broom graphs, selected hub degrees and thresholds, and 12 evolving trajectory cases.',
    limits: 'One device and bounded graph shapes cannot establish a universal threshold or production speedup.',
    evidence: [{ label: 'Hub trajectory and timing evidence', page: 'acceptance' }, { label: 'Earlier hub measurements', page: 'findings' }],
  },
}]
