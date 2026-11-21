import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'

export const experiment = defineExperiment({
  id: 'million-graph',
  title: 'Million-point moving graph',
  summary: 'Compare individual and shared distant pushes on a moving WebGPU graph.',
  tags: ['simulation', 'repulsion', 'WebGPU', 'large-data'],
  cases,
  create: async host => (await import('./view')).createMillionGraphView(host, undefined, {
    points: 65536, distribution: 'persistent-communities', force: 'four-corners',
  }),
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
      id: 'draw-cost',
      title: 'Million-point drawing cost',
      load: async (): Promise<string> => (await import('./draw-cost.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'interactive-study',
      title: 'Moving graph interaction',
      load: async (): Promise<string> => (await import('./interactive-study.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'production-envelope',
      title: 'Acceptance scope on M3',
      load: async (): Promise<string> => (await import('./production-envelope.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'results',
      title: 'Million-point findings',
      load: async (): Promise<string> => (await import('../workgroup-repulsion/moving-million.md?raw')).default,
    },
  ],
})
