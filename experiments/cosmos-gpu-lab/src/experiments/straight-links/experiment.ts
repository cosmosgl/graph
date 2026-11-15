import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'straight-links',
  title: 'Straight-link rendering and picking',
  summary: 'Compare production Cosmos ribbons and host IDs with luma WebGPU and independent scalar masks.',
  tags: ['rendering', 'links', 'picking', 'WebGL', 'WebGPU'],
  create: async host => (await import('./view')).createLinksView(host),
  pages: [{ kind: 'markdown', id: 'method', title: 'Method and findings', load: async (): Promise<string> => (await import('./method.md?raw')).default }],
})
