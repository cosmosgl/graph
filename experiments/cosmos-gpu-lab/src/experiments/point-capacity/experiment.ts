import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'point-capacity',
  title: 'Point capacity and memory',
  summary: 'Grow and shrink a resident graph on the same devices; check retained data, resize costs and buffer cleanup.',
  tags: ['simulation', 'resources', 'WebGPU'],
  create: async host => (await import('./view')).createCapacityView(host),
  pages: [{
    kind: 'markdown',
    id: 'reuse',
    title: 'Retained capacity',
    load: async (): Promise<string> => (await import('./reuse.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'findings',
    title: 'Resize contract and findings',
    load: async (): Promise<string> => (await import('./findings.md?raw')).default,
  }],
})
