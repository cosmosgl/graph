import { defineExperiment } from '../../runtime/experiment'
import { readStudyRecord } from '../../runtime/study-record'
import recordedSummary from './recorded-summary.json'
import { cases } from './cases'
import { renderYoutubeCapacity } from './youtube-capacity-figure'
export const experiment = defineExperiment({
  id: 'viewer-comparison',
  title: 'Graph interaction in WebGL and WebGPU',
  summary: 'Compare how the same small graph looks and responds in production WebGL and experimental WebGPU.',
  tags: ['integration', 'rendering', 'interaction'],
  cases,
  study: {
    record: readStudyRecord(recordedSummary, 'viewer-comparison'),
    recipePage: 'agent-recipe',
  },
  create: async host => (await import('./view')).createView(host),
  pages: [
    {
      kind: 'markdown',
      id: 'migration-results',
      title: 'Recorded prototype benchmark results',
      load: async (): Promise<string> => (await import('./benchmark-findings.md?raw')).default,
      examples: { youtubeCapacity: renderYoutubeCapacity },
    },
    {
      kind: 'markdown',
      id: 'migration-benchmark',
      title: 'Replay the prototype benchmark',
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
