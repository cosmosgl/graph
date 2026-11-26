import type { ExperimentInstance } from '../../runtime/experiment'
import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'

export const experiment = defineExperiment({
  id: 'scalable-reduction',
  title: 'Scalable reduction',
  summary: 'Reduce up to ten million GPU-resident points through a dynamic hierarchy of compute passes.',
  tags: ['compute', 'million-scale', 'WebGPU'],
  cases,
  showRecordedSummary: false,
  howItWorks: {
    summary: 'WebGPU sums positions and counts in groups of 256, then combines the groups until one sum and count remain. ' +
      'Dividing them gives the center, shown in gold. Copying it to the CPU checks the count and coordinates. ' +
      'With copying off, tick time measures how long the CPU takes to submit the work.',
  },
  create: async (host): Promise<ExperimentInstance> => {
    const module = await import('./view')
    return module.createScalableReductionExperiment(host)
  },
  pages: [
    {
      kind: 'markdown',
      id: 'overview',
      title: 'Overview',
      load: async (): Promise<string> => (await import('./docs/overview.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'implementation',
      title: 'Implementation',
      load: async (): Promise<string> => (await import('./docs/implementation.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'results',
      title: 'Results',
      load: async (): Promise<string> => (await import('./docs/results.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'performance',
      title: 'Performance',
      load: async (): Promise<string> => (await import('./docs/performance.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'limitations',
      title: 'Limitations',
      load: async (): Promise<string> => (await import('./docs/limitations.md?raw')).default,
    },
  ],
})
