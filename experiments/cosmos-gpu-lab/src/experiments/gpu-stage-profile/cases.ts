import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'profile-stages',
  title: 'Profile a fixed graph frame',
  kind: 'measure',
  question: 'Which stages use the most GPU time for a fixed graph?',
  description: 'Compare normal-frame timings with a separate diagnostic run that times individual stages.',
  tryIt: 'Use the 4,096-point initial chain and press Prepare + profile. Compare the normal frame with the diagnostic stages.',
  reference: 'Identical frozen inputs, exact replay and the existing CPU position checks for each timed trial.',
  acceptance: 'Interpret timings only for valid replay and CPU checks. Split-pass diagnostic times are not a normal-frame breakdown.',
  recorded: {
    conclusion: 'Hub springs and grid aggregation were major costs in the recorded controlled cases.',
    date: '11 November 2026',
    environment: 'Apple M3, standalone Chrome 156.',
    scope: 'Selected frozen resident and rebuilt inputs with normal-frame and instrumented-stage timing.',
    limits: 'One device and bounded inputs. Instrumented stages change scheduling; their sum is not normal-frame latency.',
    evidence: [{ label: 'Profiling method and findings', page: 'method' }],
  },
}]
