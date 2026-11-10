import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'many-body-grid',
  title: 'Hierarchical global repulsion',
  summary: 'Compare production grid repulsion with luma WebGPU: distant cell aggregates, sampled near neighbors and exact-force error.',
  tags: ['simulation', 'repulsion', 'WebGL', 'WebGPU'],
  create: async host => (await import('./view')).createGridExperiment(host),
  pages: [
    {
      kind: 'markdown',
      id: 'centroids',
      title: 'Centroid pass',
      load: async (): Promise<string> => (await import('./docs/centroids.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'precision',
      title: 'Precision investigation',
      load: async (): Promise<string> => (await import('./docs/precision.md?raw')).default,
    },
    { kind: 'markdown', id: 'overview', title: 'How it works', load: async (): Promise<string> => (await import('./docs/overview.md?raw')).default },
    { kind: 'markdown', id: 'results', title: 'Validation and findings', load: async (): Promise<string> => (await import('./docs/results.md?raw')).default },
  ],
})
