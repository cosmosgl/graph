import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'production-settings',
  title: 'Layout optimizations at production-style settings',
  kind: 'recorded',
  question: 'Did hub prefetch and ordered grid aggregation preserve the layout at the checked ticks?',
  description: 'Two WebGPU prototypes started from the same graph. One prefetched hub neighbors and cached grid cell IDs.',
  reference: 'The strict WebGPU baseline and deterministic CPU compatibility checks on the same selected graph.',
  acceptance: 'At each scheduled checkpoint, both paths had to satisfy the original CPU tolerance and agree on the checked output bits.',
  recorded: {
    conclusion: 'Selected production-style sampling, varied springs and longer-run controls passed the recorded checks.',
    date: 'Not recorded',
    environment: 'Apple M3, Chrome 156; luma 10.0.0-alpha.4.',
    scope: 'Selected 32-sample and adaptive settings, varied springs and 5,000-tick controls.',
    limits: 'Both timed paths were Lab prototypes on one device. The packaged Graph uses different spring and grid implementations.',
    evidence: [{ label: 'Production-setting findings', page: 'production' }, { label: 'Earlier fixed-setting findings', page: 'findings' }],
  },
}]
