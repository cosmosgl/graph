import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'ordered-aggregation',
  title: 'Compare ordered grid aggregation',
  kind: 'compare',
  question: 'Can cached cell membership reduce work without changing the ordered sums?',
  description: 'Compare the existing grid aggregation with a candidate that caches cell IDs and preserves addition order.',
  tryIt: 'Press Compare selected for the default chain. Read the checks beside the baseline and candidate frame times.',
  reference: 'The source-index-ordered baseline and independent CPU checks on the same frozen graph.',
  acceptance: 'The checked aggregates and outputs must match while the existing CPU position tolerances stay unchanged.',
  recorded: {
    conclusion: 'The bounded sorted-cache candidate preserved checked ordered sums. Its frame-time benefit depended on the input and candidate.',
    date: 'Not recorded',
    environment: 'Apple M3, standalone Chrome 156.',
    scope: 'Selected chain and community graphs, point counts and occupancy distributions using the strict-force reference settings.',
    limits: 'One device and bounded workloads. Diagnostic stage timings are separate from normal-frame cost.',
    evidence: [{ label: 'Aggregation evidence', page: 'findings' }],
  },
}]
