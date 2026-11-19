import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'point-styling',
  title: 'Point styling and picking',
  summary: 'Compare production Cosmos shapes and host picking with luma WebGPU, down to the rendered pixels.',
  tags: ['rendering', 'picking', 'WebGL', 'WebGPU'],
  create: async host => (await import('./view')).createStylingView(host),
  pages: [
    { kind: 'markdown', id: 'method', title: 'Method and findings', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    {
      kind: 'markdown',
      id: 'transition-method',
      title: 'Point transition protocol',
      load: async (): Promise<string> => (await import('./transition-method.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'transition-findings',
      title: 'Point transitions and exits',
      load: async (): Promise<string> => (await import('./transition-findings.md?raw')).default,
    },
  ],
})
