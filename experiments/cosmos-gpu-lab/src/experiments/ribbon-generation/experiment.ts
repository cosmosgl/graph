import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'ribbon-generation',
  title: 'Compute ribbon generation',
  summary: 'Stopped investigation: the simple compute cache did not demonstrate a consistent benefit over vertex generation.',
  tags: ['WebGPU', 'compute', 'rendering', 'links', 'archived'],
  cases,
  create: async host => (await import('./view')).createRibbonView(host),
  pages: [{
    kind: 'markdown',
    id: 'case-evidence',
    title: 'Compute-cache evidence',
    load: async (): Promise<string> => (await import('./case-evidence.md?raw')).default,
  },
  { kind: 'markdown', id: 'method', title: 'Method and research', load: async (): Promise<string> => (await import('./method.md?raw')).default },
  { kind: 'markdown', id: 'findings', title: 'First native cost screen', load: async (): Promise<string> => (await import('./findings.md?raw')).default }],
})
