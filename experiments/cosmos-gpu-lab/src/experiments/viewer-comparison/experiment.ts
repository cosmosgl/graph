import { defineExperiment } from '../../runtime/experiment'
import { readStudyRecord } from '../../runtime/study-record'
import recordedSummary from './recorded-summary.json'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'viewer-comparison',
  title: 'Graph interaction in WebGL and WebGPU',
  summary: 'Compare how the same small graph looks and responds in production WebGL and experimental WebGPU.',
  tags: ['integration', 'rendering', 'interaction'],
  cases,
  study: {
    record: readStudyRecord(recordedSummary, 'viewer-comparison'),
    recipePage: 'agent-recipe',
    visualFirst: true,
    liveDescription: 'Each dot is a person and each line is a connection.',
  },
  create: async host => (await import('./view')).createView(host),
  pages: [
    {
      kind: 'markdown',
      id: 'migration-results',
      title: 'Matched migration benchmark results',
      load: async (): Promise<string> => (await import('./benchmark-findings.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'migration-benchmark',
      title: 'Run the migration benchmark',
      load: async (): Promise<string> => (await import('./benchmark-method.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'performance-audit',
      title: 'What each performance example measures',
      load: async (): Promise<string> => (await import('./performance-audit.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'link-color-evidence',
      title: 'Link-color evidence',
      load: async (): Promise<string> => (await import('./link-color-evidence.md?raw')).default,
    },
    { kind: 'markdown', id: 'method', title: 'Historical comparison method', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'Graph comparison findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
    {
      kind: 'markdown',
      id: 'agent-recipe',
      title: 'Reproduce with an agent',
      load: async (): Promise<string> => (await import('./agent-recipe.md?raw')).default,
    },
  ],
})
