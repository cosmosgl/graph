import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'resize-preservation',
  title: 'Resize a graph without losing points',
  kind: 'compare',
  question: 'Can the graph grow and shrink while keeping its existing point data?',
  description: 'Compare rebuilding GPU storage with keeping capacity available for later changes.',
  tryIt: 'Start with the 2,048-point chain and press Run resize cycles. It grows to 8,192 points, shrinks and regrows; inspect the checks and costs.',
  reference: 'Expected surviving and new point records, a GPU-rebuild control and subsequent CPU compatibility checks.',
  acceptance: 'Surviving records, pins and absence must be preserved; new points are initialized and later frame checks are reported separately.',
  recorded: {
    conclusion: 'The recorded resize cycles preserved the checked state. Reusing available capacity reduced update cost in the measured cases.',
    date: '11 November 2026',
    environment: 'Apple M3, standalone Chrome 156.',
    scope: 'Selected grow, shrink and regrow cycles with GPU rebuild and retained-capacity lanes.',
    limits: 'One device and bounded workloads. Faster steady-state frames, the full public API and total GPU memory were not established.',
    evidence: [{ label: 'Resize and capacity evidence', page: 'reuse' }, { label: 'Earlier rebuild comparison', page: 'findings' }],
    charts: [{
      title: 'Reusing buffers cut resize time to 0.6 ms',
      context: 'Median resize completion · Chain shrinking from 8,192 to 2,048 points',
      unit: 'ms',
      bars: [['Rebuild buffers', 19.3], ['Keep buffers', 0.6]],
    }, {
      title: 'Keeping buffers used more memory after the shrink',
      context: 'Tracked application buffers for the same chain after shrinking to 2,048 points',
      unit: 'MiB',
      bars: [['Rebuild buffers', 3.64], ['Keep buffers', 14.656]],
    }],
  },
}]
