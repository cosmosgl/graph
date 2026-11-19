import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'curved-links',
  title: 'Curved solid-link rendering and picking',
  summary: 'Compare production Cosmos rational ribbons with luma WebGPU and independent triangle-strip masks.',
  tags: ['rendering', 'links', 'curves', 'picking', 'WebGL', 'WebGPU'],
  cases,
  create: async host => (await import('./view')).createCurvesView(host),
  pages: [
    {
      kind: 'markdown',
      id: 'case-evidence',
      title: 'Curved-link evidence',
      load: async (): Promise<string> => (await import('./case-evidence.md?raw')).default,
    },
    { kind: 'markdown', id: 'method', title: 'Method and findings', load: async (): Promise<string> => (await import('./method.md?raw')).default },
  ],
})
