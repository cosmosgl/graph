import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'pilot-viewer',
  title: 'Karate Club pilot viewer',
  summary: 'Try the bounded WebGPU pilot as a small graph explorer: find members, inspect neighbors and move the running graph.',
  tags: ['integration', 'interaction'],
  create: async host => (await import('./view')).createView(host),
  pages: [
    { kind: 'markdown', id: 'scope', title: 'First pilot contract', load: async (): Promise<string> => (await import('./scope.md?raw')).default },
    {
      kind: 'markdown',
      id: 'findings',
      title: 'Representative viewer findings',
      load: async (): Promise<string> => (await import('./findings.md?raw')).default,
    },
  ],
})
