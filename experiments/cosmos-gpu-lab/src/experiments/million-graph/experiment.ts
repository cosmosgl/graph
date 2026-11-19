import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'million-graph',
  title: 'Million-point moving graph',
  summary: 'Compare individual and shared distant pushes on a moving WebGPU graph.',
  tags: ['simulation', 'repulsion', 'WebGPU', 'large-data'],
  create: async host => (await import('./view')).createMillionGraphView(host),
  pages: [
    { kind: 'markdown', id: 'overview', title: 'How it works', load: async (): Promise<string> => (await import('./overview.md?raw')).default },
    {
      kind: 'markdown',
      id: 'cell-field',
      title: 'Sharing distant repulsion',
      load: async (): Promise<string> => (await import('./cell-field.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'dense-communities',
      title: 'Persistent dense communities',
      load: async (): Promise<string> => (await import('./dense-communities.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'results',
      title: 'Million-point findings',
      load: async (): Promise<string> => (await import('../workgroup-repulsion/moving-million.md?raw')).default,
    },
  ],
})
