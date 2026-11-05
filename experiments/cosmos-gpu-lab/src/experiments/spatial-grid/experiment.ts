import type { ExperimentInstance } from '../../runtime/experiment'
import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'spatial-grid',
  title: 'Spatial grid builder',
  summary: 'Build a million-scale CSR spatial index with GPU count, scan and scatter passes.',
  tags: ['compute', 'grid', 'scan', 'scatter', 'million-scale', 'WebGPU'],
  create: async (host): Promise<ExperimentInstance> => {
    const module = await import('./view')
    return module.createSpatialGridExperiment(host)
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
      id: 'buffers',
      title: 'Buffers',
      load: async (): Promise<string> => (await import('./docs/buffers.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'validation',
      title: 'Validation',
      load: async (): Promise<string> => (await import('./docs/validation.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'performance',
      title: 'Performance',
      load: async (): Promise<string> => (await import('./docs/performance.md?raw')).default,
    },
  ],
})
