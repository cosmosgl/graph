import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'production-settings',
  title: 'Check production-style layout settings',
  kind: 'compare',
  question: 'Do the optimized layout calculations pass the existing checks with production-style settings?',
  description: 'Compare the strict baseline with a candidate using hub prefetch and cached grid aggregation.',
  tryIt: 'Press Compare selected to check the default 8,192-point chain and inspect the baseline and candidate results.',
  reference: 'The strict WebGPU baseline and deterministic CPU compatibility checks on the same selected graph.',
  acceptance: 'The existing numerical tolerances, routing boundaries and exact output checks remain unchanged.',
  recorded: {
    conclusion: 'Selected production-style sampling, varied springs and longer-run controls passed the recorded checks.',
    date: 'Not recorded',
    environment: 'Apple M3, Chrome 156; luma 10.0.0-alpha.4.',
    scope: 'Selected 32-sample and adaptive settings, varied springs and 5,000-tick controls.',
    limits: 'These checks cover a force slice and selected parameters on one device; they do not establish complete production acceptance.',
    evidence: [{ label: 'Production-setting findings', page: 'production' }, { label: 'Earlier fixed-setting findings', page: 'findings' }],
  },
}]
