import type { ExperimentInstance } from '../../runtime/experiment'
import { defineExperiment } from '../../runtime/experiment'
import { centerMassCase, centerMassPage } from './cases'

export const experiment = defineExperiment({
  id: 'center-mass',
  title: 'Center of mass',
  summary: 'Compare center calculations and explore the cost and behavior of the center force.',
  tags: ['compute', 'reduction', 'WebGL', 'WebGPU'],
  cases: [centerMassCase],
  singlePage: centerMassPage,
  create: async (host, _caseId, options): Promise<ExperimentInstance> => {
    const module = await import('./view')
    return await module.createCenterMassExperiment(host, options)
  },
  pages: [
    {
      kind: 'markdown',
      id: 'cost-evidence',
      title: 'Center-force measurement evidence',
      load: async (): Promise<string> => (await import('./docs/cost-evidence.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'trajectory-evidence',
      title: 'Center-force trajectory evidence',
      load: async (): Promise<string> => (await import('./docs/trajectory-evidence.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'overview',
      title: 'Overview',
      load: async (): Promise<string> => (await import('./docs/overview.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'algorithm',
      title: 'Algorithm',
      load: async (): Promise<string> => (await import('./docs/algorithm.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'implementation',
      title: 'Implementation',
      load: async (): Promise<string> => (await import('./docs/implementation.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'correctness',
      title: 'Correctness',
      load: async (): Promise<string> => (await import('./docs/correctness.md?raw')).default,
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
      id: 'scale-method',
      title: 'M3 scale study',
      load: async (): Promise<string> => (await import('./docs/scale-method.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'scale-findings',
      title: 'M3 scale findings',
      load: async (): Promise<string> => (await import('./docs/scale-findings.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'once-findings',
      title: 'Center calculated once',
      load: async (): Promise<string> => (await import('./docs/once-findings.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'limitations',
      title: 'Limitations',
      load: async (): Promise<string> => (await import('./docs/limitations.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'references',
      title: 'References',
      load: async (): Promise<string> => (await import('./docs/references.md?raw')).default,
    },
  ],
})
