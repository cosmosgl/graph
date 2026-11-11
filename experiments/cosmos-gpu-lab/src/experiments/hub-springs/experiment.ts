import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'hub-springs',
  title: 'Ordered hub springs',
  summary: 'Sweep hub degree and pinning, then compare order-preserving spring candidates on one device and identical frozen inputs.',
  tags: ['benchmark', 'simulation', 'WebGPU'],
  create: async host => (await import('./view')).createHubView(host),
  pages: [{
    kind: 'markdown',
    id: 'findings',
    title: 'Method and findings',
    load: async (): Promise<string> => (await import('./findings.md?raw')).default,
  }],
})
