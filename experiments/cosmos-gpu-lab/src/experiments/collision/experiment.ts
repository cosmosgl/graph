import { defineExperiment } from '../../runtime/experiment'
export const experiment = defineExperiment({
  id: 'collision',
  title: 'Collision constraints',
  summary: 'Compare production all-pairs disc collision, luma WebGPU and CPU; validate composition and measure the added GPU cost.',
  tags: ['simulation', 'collision', 'WebGL', 'WebGPU'],
  create: async host => (await import('./view')).createCollisionView(host),
  pages: [
    { kind: 'markdown', id: 'method', title: 'How collision works', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'trajectories', title: 'Independent layouts', load: async (): Promise<string> => (await import('./trajectories.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'Findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
  ],
})
