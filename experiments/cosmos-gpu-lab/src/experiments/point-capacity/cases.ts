import type { ExperimentCase } from '../../runtime/experiment'

export const cases: ExperimentCase[] = [{
  id: 'resize-preservation',
  title: 'Keep existing positions as the point count changes',
  kind: 'compare',
  question: 'Can we add and remove points faster by reusing GPU memory?',
  description: 'One preview rebuilds its GPU buffers every time the point count changes. The other reuses the buffers whenever the points fit.',
  tryIt: 'Add and remove points changes the count four times and checks positions and forces in the next frame after each change. ' +
    'The run ends at 2,048 points.',
  reference: 'The expected point data after each change and an optional CPU calculation for the next simulation step.',
  acceptance: 'Points that stay keep their positions, pins and visibility. Added points get their expected starting data. ' +
    'The next frame must match across both previews and meet the CPU tolerance when that check is enabled.',
  recorded: {
    conclusion: 'Both WebGPU approaches kept the positions of points that stayed in the graph. ' +
      'Reuse made measured changes faster when the new count fit. Rebuilding used less buffer memory after the graph shrank.',
    date: '11 November 2026',
    environment: 'Apple M3, standalone Chrome 156.',
    scope: 'Selected grow, shrink and regrow cycles with GPU rebuild and retained-capacity lanes.',
    limits: 'One device and bounded workloads. Faster steady-state frames, the full public API and total GPU memory were not established.',
    evidence: [{ label: 'Buffer reuse results', page: 'reuse' }],
    charts: [{
      title: 'Reusing buffers cut the update time to 0.6 ms',
      context: 'Median time to go from 8,192 to 2,048 points in the chain graph',
      unit: 'ms',
      bars: [['Rebuild buffers', 19.3], ['Reuse buffers', 0.6]],
    }, {
      title: 'Rebuilding used less buffer memory after the shrink',
      context: 'Tracked application buffers for the same chain after shrinking to 2,048 points',
      unit: 'MiB',
      bars: [['Rebuild buffers', 3.64], ['Reuse buffers', 14.656]],
    }],
  },
}]
