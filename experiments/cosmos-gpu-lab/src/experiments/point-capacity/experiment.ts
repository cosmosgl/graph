import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'
import { renderRetainedCapacity } from './retained-capacity-figure'
export const experiment = defineExperiment({
  id: 'point-capacity',
  title: 'Adding and removing points',
  summary: 'Compare the time and GPU memory needed to add or remove points when rebuilding or reusing buffers.',
  tags: ['simulation', 'resources', 'WebGPU'],
  cases,
  create: async host => (await import('./view')).createCapacityView(host, 'reuse'),
  pages: [{
    kind: 'markdown',
    id: 'reuse',
    title: 'Reusing GPU buffers',
    load: async (): Promise<string> => (await import('./reuse.md?raw')).default,
    examples: { retainedCapacity: renderRetainedCapacity },
  }],
})
