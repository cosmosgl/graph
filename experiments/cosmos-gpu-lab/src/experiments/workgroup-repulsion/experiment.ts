import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'

export const experiment = defineExperiment({
  id: 'workgroup-repulsion',
  title: 'Workgroup repulsion',
  summary: 'Try the workgroup-memory variant of hierarchical global repulsion.',
  tags: ['simulation', 'repulsion', 'WebGPU'],
  cases,
  create: async host => (await import('../many-body-grid/view')).createGridExperiment(host, {
    initialFarMode: 'workgroup-local', experimentId: 'workgroup-repulsion',
  }),
  pages: [
    {
      kind: 'markdown',
      id: 'case-evidence',
      title: 'Workgroup repulsion evidence',
      load: async (): Promise<string> => (await import('./case-evidence.md?raw')).default,
    },
    { kind: 'markdown', id: 'overview', title: 'How it works', load: async (): Promise<string> => (await import('./overview.md?raw')).default },
    {
      kind: 'markdown',
      id: 'direct-alternatives',
      title: 'Workgroup findings',
      load: async (): Promise<string> => (await import('../many-body-grid/docs/direct-alternatives.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'force-speed',
      title: 'Faster repulsion',
      load: async (): Promise<string> => (await import('./force-speed.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'moving-million',
      title: 'Moving million-point graph',
      load: async (): Promise<string> => (await import('./moving-million.md?raw')).default,
    },
  ],
})
