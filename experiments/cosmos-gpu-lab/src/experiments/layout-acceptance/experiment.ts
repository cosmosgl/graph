import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'layout-acceptance',
  title: 'Production layout gates',
  summary: 'Validate exact/grid routing and evolving layouts with hub prefetch and ordered grid aggregation enabled together.',
  tags: ['simulation', 'benchmark', 'compute'],
  create: async host => (await import('../cell-aggregation/view')).createGridAggregationView(host, true),
  pages: [{ kind: 'markdown', id: 'findings', title: 'Method and findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default }],
})
