import type { ExperimentInstance, ExperimentReport } from '../../runtime/experiment'
import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'scalable-reduction',
  title: 'Scalable reduction',
  summary: 'Reduce up to ten million GPU-resident points through a dynamic hierarchy of compute passes.',
  tags: ['compute', 'million-scale', 'WebGPU'],
  create: async (host): Promise<ExperimentInstance> => {
    const module = await import('./view')
    return module.createScalableReductionExperiment(host)
  },
  pages: [
    {
      kind: 'markdown',
      id: 'overview',
      title: 'Overview',
      load: async (): Promise<string> => (await import('./docs/overview.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'algorithm',
      title: 'Algorithm',
      load: async (): Promise<string> => (await import('./docs/algorithm.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'implementation',
      title: 'Implementation',
      load: async (): Promise<string> => (await import('./docs/implementation.md?raw')).default,
    },
    {
      kind: 'report',
      id: 'results',
      title: 'Results',
      load: async (): Promise<ExperimentReport> =>
        (await import('./reports/validation.json')).default as ExperimentReport,
    },
    {
      kind: 'markdown',
      id: 'performance',
      title: 'Performance',
      load: async (): Promise<string> => (await import('./docs/performance.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'limitations',
      title: 'Limitations',
      load: async (): Promise<string> => (await import('./docs/limitations.md?raw')).default,
    },
  ],
})
