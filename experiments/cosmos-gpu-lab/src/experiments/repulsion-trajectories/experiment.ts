import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'repulsion-trajectories',
  title: 'Repulsion trajectories',
  summary: 'Let production WebGL, corrected WebGPU and CPU evolve independently; separate local correctness from accumulated drift.',
  tags: ['simulation', 'repulsion', 'validation'],
  cases,
  create: async host => (await import('./view')).createTrajectories(host),
  pages: [{
    kind: 'markdown',
    id: 'findings',
    title: 'Method and findings',
    load: async (): Promise<string> => (await import('./docs/findings.md?raw')).default,
  }],
})
