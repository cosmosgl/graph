import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'smoothstep-coverage',
  title: 'Why a line edge changes',
  summary: 'Compare two ways of calculating the same line edge in WebGL and WebGPU.',
  tags: ['rendering', 'links', 'precision', 'WebGL', 'WebGPU'],
  create: async host => (await import('./view')).createSmoothstepView(host),
  pages: [
    { kind: 'markdown', id: 'method', title: 'How the comparison works', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'M3 result', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
  ],
})
