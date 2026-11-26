import type { ExperimentInstance } from '../../runtime/experiment'
import { defineExperiment } from '../../runtime/experiment'
import type { LiveCheckGroup } from '../../runtime/live-checks'
import { cases } from './cases'

export const experiment = defineExperiment({
  id: 'spatial-grid',
  title: 'Spatial grid builder',
  summary: 'Build a million-scale CSR spatial index with GPU count, scan and scatter passes.',
  tags: ['compute', 'grid', 'scan', 'scatter', 'million-scale', 'WebGPU'],
  cases,
  showRecordedSummary: false,
  howItWorks: {
    relatedExperiments: ['neighborhood-forces', 'many-body-grid'],
    summary: 'Cosmos uses textures to group points for many-body forces in WebGL. This WebGPU builder stores the IDs in each cell ' +
      'as one continuous range. [Neighborhood forces](#/neighborhood-forces) reads nearby ranges to find neighbors. ' +
      '[Hierarchical global repulsion](#/many-body-grid) uses them to build its finest cells. Both use the index directly on the GPU.\n\n' +
      'Brighter cells contain more points. Build time ends before the grid is copied to the CPU for validation. ' +
      'The passing checks establish cell membership on one adapter. Force accuracy, traversal cost and performance on other GPUs need separate checks.',
  },
  create: async (host): Promise<ExperimentInstance> => {
    const module = await import('./view')
    return module.createSpatialGridExperiment(host)
  },
  pages: [
    {
      kind: 'markdown',
      id: 'overview',
      relatedExperiments: ['neighborhood-forces', 'many-body-grid'],
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
      id: 'buffers',
      title: 'Buffers',
      load: async (): Promise<string> => (await import('./docs/buffers.md?raw')).default,
    },
    {
      kind: 'live-checks',
      id: 'validation',
      title: 'Automated test results',
      load: async (): Promise<LiveCheckGroup[]> => (await import('./grid-suite')).gridGroups,
    },
    {
      kind: 'markdown',
      id: 'performance',
      relatedExperiments: ['neighborhood-forces'],
      title: 'Performance',
      load: async (): Promise<string> => (await import('./docs/performance.md?raw')).default,
    },
  ],
})
