import { defineExperiment } from '../../runtime/experiment'

export const experiment = defineExperiment({
  id: 'mouse-repulsion',
  title: 'Mouse repulsion',
  summary: 'Compare the pointer force in production WebGL and WebGPU, including when the main simulation is paused.',
  tags: ['simulation', 'interaction'],
  create: async host => (await import('./view')).createView(host),
  pages: [
    { kind: 'markdown', id: 'method', title: 'How mouse repulsion works', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'Mouse repulsion findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
    {
      kind: 'markdown',
      id: 'agent-recipe',
      title: 'Reproduce the mouse study',
      load: async (): Promise<string> => (await import('./agent-recipe.md?raw')).default,
    },
  ],
})
