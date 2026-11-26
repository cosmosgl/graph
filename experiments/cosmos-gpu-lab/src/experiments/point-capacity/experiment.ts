import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'
import { renderRetainedCapacity } from './retained-capacity-figure'
export const experiment = defineExperiment({
  id: 'point-capacity',
  title: 'Adding and removing points',
  summary: 'Compare update time and GPU buffer memory for rebuild and reuse on your device.',
  tags: ['simulation', 'resources', 'WebGPU'],
  cases,
  showRecordedSummary: false,
  howItWorks: {
    summary: 'Both WebGPU previews add and remove the same points. **Rebuild** makes new buffers sized for each count. ' +
      '**Reuse** keeps its buffers when the points fit. It can update faster and keeps more buffer memory allocated after points are removed.',
    figure: renderRetainedCapacity,
  },
  create: async host => (await import('./view')).createCapacityView(host),
  pages: [{
    kind: 'markdown',
    id: 'method',
    title: 'Reusing GPU buffers',
    load: async (): Promise<string> => (await import('./method.md?raw')).default,
  }],
})
