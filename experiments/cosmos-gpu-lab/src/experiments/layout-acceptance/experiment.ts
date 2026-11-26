import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'layout-acceptance',
  title: 'Archived layout optimization study',
  summary: 'Recorded checks of hub prefetch and ordered grid aggregation on two WebGPU prototypes.',
  tags: ['simulation', 'benchmark', 'compute', 'archived'],
  cases,
  pages: [
    {
      kind: 'markdown',
      id: 'production',
      title: 'Production-style settings',
      relatedExperiments: ['production-forces'],
      load: async (): Promise<string> => (await import('./production.md?raw')).default,
    },
    { kind: 'markdown', id: 'findings', title: 'Method and findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
  ],
})
