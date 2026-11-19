import type { ExperimentInstance } from '../../runtime/experiment'
import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'

export const experiment = defineExperiment({
  id: 'point-rendering',
  title: 'Circle point rendering',
  summary: 'Compare Cosmos WebGL point sprites with portable WebGPU instanced quads.',
  tags: ['rendering', 'points', 'WebGL', 'WebGPU'],
  cases,
  create: async (host): Promise<ExperimentInstance> => {
    const module = await import('./view')
    return module.createPointRenderingExperiment(host)
  },
  pages: [
    {
      kind: 'markdown',
      id: 'case-method',
      title: 'Circle comparison method',
      load: async (): Promise<string> => (await import('./docs/case-method.md?raw')).default,
    },
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
      id: 'limitations',
      title: 'Next steps',
      load: async (): Promise<string> => (await import('./docs/limitations.md?raw')).default,
    },
  ],
})
