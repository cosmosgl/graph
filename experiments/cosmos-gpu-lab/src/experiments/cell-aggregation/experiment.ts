import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'cell-aggregation',
  title: 'Ordered grid aggregation',
  summary: 'Cache binned cell IDs while preserving source-index sums, then compare normal frames, diagnostic costs and occupancy.',
  tags: ['benchmark', 'compute', 'simulation'],
  create: async host => (await import('./view')).createGridAggregationView(host),
  pages: [{ kind: 'markdown', id: 'findings', title: 'Method and findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default }],
})
