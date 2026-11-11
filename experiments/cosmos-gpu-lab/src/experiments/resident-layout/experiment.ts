import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'resident-layout',
  title: 'GPU-resident layout',
  summary: 'Keep bounds, composed forces and circle/link rendering on WebGPU; compare checkpoints with the staged precision reference.',
  tags: ['simulation', 'integration', 'WebGPU'],
  create: async host => (await import('./view')).createResidentView(host),
  pages: [{
    kind: 'markdown',
    id: 'dataflow',
    title: 'Dataflow and findings',
    load: async (): Promise<string> => (await import('./dataflow.md?raw')).default,
  }],
})
