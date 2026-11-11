import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'matched-layout',
  title: 'Matched layout comparison',
  summary: 'Evolve production GLSL, luma WebGPU and CPU from shared inputs; measure layout quality separately from strict frozen-input checks.',
  tags: ['simulation', 'validation', 'layout'],
  create: async host => (await import('./view')).createMatchedView(host),
  pages: [
    { kind: 'markdown', id: 'method', title: 'Method', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'Findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
  ],
})
