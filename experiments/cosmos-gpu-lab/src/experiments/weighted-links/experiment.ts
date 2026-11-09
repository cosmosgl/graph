import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'weighted-links',
  title: 'Weighted link forces',
  summary: 'Port Cosmos springs to luma compute: stable directional CSR, weighted forces, integration and resident point/link rendering.',
  tags: ['simulation', 'WebGL', 'WebGPU', 'topology', 'luma'],
  create: async host => (await import('./view')).createWeightedLinksExperiment(host),
  pages: [
    {
      kind: 'markdown',
      id: 'context-loss',
      title: 'WebGL reset investigation',
      load: async (): Promise<string> => (await import('./docs/context-loss.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'performance',
      title: 'Topology sweep findings',
      load: async (): Promise<string> => (await import('./docs/performance.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'overview',
      title: 'Cosmos spring contract',
      load: async (): Promise<string> => (await import('./docs/overview.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'implementation',
      title: 'CSR and luma implementation',
      load: async (): Promise<string> => (await import('./docs/implementation.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'results',
      title: 'Validation and reproduction',
      load: async (): Promise<string> => (await import('./docs/results.md?raw')).default,
    },
  ],
})
