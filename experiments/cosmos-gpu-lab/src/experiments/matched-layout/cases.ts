import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'compare-layouts',
  title: 'Compare matched graph layouts',
  kind: 'compare',
  question: 'Do the WebGL, WebGPU and CPU layouts evolve similarly from the same graph?',
  description: 'The three layouts start with the same points, links and sampling decisions, then evolve independently.',
  tryIt: 'Start with the 128-point chain and press Step + check. Run comparison advances the full cooling schedule.',
  reference: 'A float32 CPU compatibility model and matched frozen-input checks; layout quality is measured separately.',
  acceptance: 'Numerical checks use the existing tolerances. Layout-quality and drift measures have no pass threshold.',
  recorded: {
    conclusion: 'The center-off WebGPU candidate had zero measured pointwise drift from the CPU in 12 runs. ' +
      'Production WebGL retained numerical check failures even though its layouts looked similar.',
    date: '11 November 2026',
    environment: 'Apple M3, standalone Chrome 156; luma 10.0.0-alpha.4.',
    scope: '12 center-off runs, 11,200 ticks, 1,132 checkpoints and 12 full-strength probes.',
    limits: 'Selected graphs and one device with a shared sampling schedule. Complete runtime behavior and intermediate ticks were not verified.',
    evidence: [{ label: 'Matched-layout findings', page: 'findings' }, { label: 'Comparison method', page: 'method' }],
  },
}, {
  id: 'center-attraction',
  title: 'Center attraction in matched layouts',
  kind: 'recorded',
  question: 'How did adding center attraction affect the recorded layout checks?',
  description: 'This earlier study compares layouts with an optional force that draws points toward their center.',
  reference: 'Independent CPU trajectories and the original WebGL and WebGPU frozen-input checks.',
  acceptance: 'The original numerical gates apply to each frozen checkpoint; layout-quality scores are observations without a pass threshold.',
  recorded: {
    conclusion: 'The historical WebGPU center-on candidate passed all 567 frozen checkpoints, while the WebGL checks retained failures. ' +
      'One long WebGPU trajectory still drifted from the CPU.',
    date: '11–12 November 2026',
    environment: 'Apple M3, standalone Chrome 156; luma 10.0.0-alpha.4.',
    scope: 'Seven center-on runs and 5,600 ticks, with a shared adaptive sampling schedule.',
    limits: 'These results used an earlier float32 reduction tree, before the current correction; they cannot be attributed to the new reduction.',
    evidence: [{ label: 'Center-enabled findings', page: 'center', section: 'native-findings-11-12-november-2026' }],
  },
}]
