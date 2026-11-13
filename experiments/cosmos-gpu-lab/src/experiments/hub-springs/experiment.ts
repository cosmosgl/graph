import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'hub-springs',
  title: 'Ordered hub springs',
  summary: 'Validate ordered hub springs over evolving layouts, then compare degree thresholds and normal-frame GPU time on one device.',
  tags: ['benchmark', 'simulation', 'WebGPU'],
  create: async host => (await import('./view')).createHubView(host),
  pages: [{
    kind: 'markdown',
    id: 'acceptance',
    title: 'Trajectories and thresholds',
    load: async (): Promise<string> => (await import('./acceptance.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'findings',
    title: 'Method and findings',
    load: async (): Promise<string> => (await import('./findings.md?raw')).default,
  }],
})
