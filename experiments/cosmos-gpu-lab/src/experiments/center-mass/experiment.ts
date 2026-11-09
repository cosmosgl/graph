import type { ExperimentInstance } from '../../runtime/experiment'
import { defineExperiment } from '../../runtime/experiment'
import reductionDiagramUrl from './diagrams/reduction-pipeline.svg?url'

const diagramAssets = {
  reductionPipeline: reductionDiagramUrl,
}

export const experiment = defineExperiment({
  id: 'center-mass',
  title: 'Global center of mass',
  summary: 'Compare Cosmos-style WebGL blending with a two-stage WebGPU compute reduction.',
  tags: ['compute', 'reduction', 'WebGL', 'WebGPU'],
  create: async (host): Promise<ExperimentInstance> => {
    const module = await import('./view')
    return module.createCenterMassExperiment(host)
  },
  pages: [
    {
      kind: 'markdown',
      id: 'overview',
      title: 'Overview',
      load: async (): Promise<string> => (await import('./docs/overview.md?raw')).default,
      assets: diagramAssets,
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
