import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'many-body',
  title: 'Global many-body repulsion',
  summary: 'Compare Cosmos’s exact all-pairs repulsion: production GLSL, ordered or tiled luma WebGPU, and an independent CPU reference.',
  tags: ['simulation', 'repulsion', 'WebGL', 'WebGPU'],
  create: async host => (await import('./view')).createManyBodyExperiment(host),
  pages: [
    { kind: 'markdown', id: 'overview', title: 'Force contract', load: async (): Promise<string> => (await import('./docs/overview.md?raw')).default },
    { kind: 'markdown', id: 'research', title: 'Implementation choices', load: async (): Promise<string> => (await import('./docs/research.md?raw')).default },
    { kind: 'markdown', id: 'results', title: 'Validation and findings', load: async (): Promise<string> => (await import('./docs/results.md?raw')).default },
  ],
})
