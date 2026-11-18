import { defineExperiment } from '../../runtime/experiment'
import { readStudyRecord } from '../../runtime/study-record'
import recordedSummary from './recorded-summary.json'
export const experiment = defineExperiment({
  id: 'viewer-comparison',
  title: 'Production and WebGPU viewers',
  summary: 'Compare the small production Graph viewer with the integrated candidate: appearance, updates and running interaction.',
  tags: ['integration', 'rendering', 'interaction'],
  study: {
    record: readStudyRecord(recordedSummary, 'viewer-comparison'),
    recipePage: 'agent-recipe',
    visualFirst: true,
    liveDescription: 'The initial graph shows 34 karate-club members as dots and 78 connections as lines. ' +
      'The viewers can arrange and frame the network differently. This new local run is separate from the recorded findings below.',
  },
  create: async host => (await import('./view')).createView(host),
  pages: [
    { kind: 'markdown', id: 'method', title: 'Viewer comparison protocol', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'Viewer comparison findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
    {
      kind: 'markdown',
      id: 'agent-recipe',
      title: 'Reproduce with an agent',
      load: async (): Promise<string> => (await import('./agent-recipe.md?raw')).default,
    },
  ],
})
