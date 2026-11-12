import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'precision-diagnostics',
  title: 'Precision diagnostics',
  summary: 'Separate analytic gravity accuracy, legacy polar compatibility and cancellation in controlled GPU sums.',
  tags: ['validation', 'precision', 'WebGL', 'WebGPU'],
  create: async host => (await import('./view')).createPrecisionView(host),
  pages: [{
    kind: 'markdown',
    id: 'method',
    title: 'Method and findings',
    load: async (): Promise<string> => (await import('./method.md?raw')).default,
  }],
})
