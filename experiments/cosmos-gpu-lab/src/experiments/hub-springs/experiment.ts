import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'hub-springs',
  title: 'Ordered hub springs',
  summary: 'Validate ordered hub springs over evolving layouts, then compare degree thresholds and normal-frame GPU time on one device.',
  tags: ['benchmark', 'simulation', 'WebGPU'],
  cases,
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
