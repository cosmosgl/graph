import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'combined-layout',
  title: 'Combined layout convergence',
  summary: 'Compose gravity, hierarchical repulsion, ordered springs and cooling; compare settling layouts and full-strength residual motion.',
  tags: ['simulation', 'convergence', 'WebGL', 'WebGPU'],
  create: async host => (await import('./view')).createCombinedView(host),
  pages: [{
    kind: 'markdown',
    id: 'findings',
    title: 'Method and findings',
    load: async (): Promise<string> => (await import('./docs/findings.md?raw')).default,
  }],
})
