import type { ExperimentInstance } from '../../runtime/experiment'
import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'

export const experiment = defineExperiment({
  id: 'performance-lab',
  title: 'Performance lab',
  summary: 'Benchmark WebGL and WebGPU rendering and simulation workloads with matched inputs.',
  tags: ['benchmark', 'rendering', 'simulation', 'WebGL', 'WebGPU'],
  cases,
  create: async (host, caseId): Promise<ExperimentInstance> => {
    const module = await import('./view')
    return module.createPerformanceLab(host, caseId)
  },
  pages: [
    {
      kind: 'markdown',
      id: 'methodology',
      title: 'Methodology',
      load: async (): Promise<string> => (await import('./docs/methodology.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'interpretation',
      title: 'Interpretation',
      load: async (): Promise<string> => (await import('./docs/interpretation.md?raw')).default,
    },
  ],
})
