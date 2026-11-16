import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'ribbon-generation',
  title: 'Compute ribbon generation',
  summary: 'Stopped investigation: the simple compute cache did not demonstrate a consistent benefit over vertex generation.',
  tags: ['WebGPU', 'compute', 'rendering', 'links', 'archived'],
  create: async host => (await import('./view')).createRibbonView(host),
  pages: [{ kind: 'markdown', id: 'method', title: 'Method and research', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'First native cost screen', load: async (): Promise<string> => (await import('./findings.md?raw')).default }],
})
