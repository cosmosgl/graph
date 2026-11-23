import type { ExperimentInstance } from '../../runtime/experiment'
import { defineExperiment } from '../../runtime/experiment'
import { cases } from './cases'

export const experiment = defineExperiment({
  id: 'point-rendering',
  title: 'Circle point rendering',
  summary: 'See how a WebGL point sprite and a WebGPU quad draw a circle.',
  tags: ['rendering', 'points', 'WebGL', 'WebGPU'],
  presentation: 'demo',
  headerContent: 'question-only',
  showRecordedSummary: false,
  howItWorks: false,
  cases,
  create: async (host): Promise<ExperimentInstance> => {
    const module = await import('./view')
    return module.createPointRenderingExperiment(host)
  },
  pages: [
    {
      kind: 'markdown',
      id: 'case-method',
      title: 'Where the circle edge comes from',
      relatedExperiments: ['point-shapes', 'point-picking'],
      load: async (): Promise<string> => (await import('./docs/case-method.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'implementation',
      title: 'Implementation',
      load: async (): Promise<string> => (await import('./docs/implementation.md?raw')).default,
    },
  ],
})
