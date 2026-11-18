import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'viewer-comparison',
  title: 'Production and WebGPU viewers',
  summary: 'Compare the small production Graph viewer with the integrated candidate: appearance, updates and running interaction.',
  tags: ['integration', 'rendering', 'interaction'],
  create: async host => (await import('./view')).createView(host),
  pages: [
    { kind: 'markdown', id: 'method', title: 'Viewer comparison protocol', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'Viewer comparison findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
  ],
})
