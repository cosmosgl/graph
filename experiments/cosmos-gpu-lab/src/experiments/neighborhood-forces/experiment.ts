import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'neighborhood-forces',
  title: 'Neighborhood forces',
  summary: 'Turn a spatial grid into motion: compare tiled all-pairs and grid-based local repulsion on WebGPU.',
  tags: ['simulation', 'neighbors', 'grid', 'WebGPU'],
  create: async host => (await import('./view')).createNeighborhoodExperiment(host),
  pages: [
    {
      kind: 'markdown',
      id: 'precision-cost',
      title: 'Precision cost',
      load: async (): Promise<string> => (await import('./docs/precision-cost.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'precision',
      title: 'Precision findings',
      load: async (): Promise<string> => (await import('./docs/precision.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'batched-results',
      title: 'Batched findings',
      load: async (): Promise<string> => (await import('./docs/batched-results.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'results',
      title: 'Results',
      load: async (): Promise<string> => (await import('./docs/results.md?raw')).default,
    },
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
    {
      kind: 'markdown',
      id: 'sweep',
      title: 'Sweep',
      load: async (): Promise<string> => (await import('./docs/sweep.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'research',
      title: 'Research',
      load: async (): Promise<string> => (await import('./docs/research.md?raw')).default,
    },
  ],
})
