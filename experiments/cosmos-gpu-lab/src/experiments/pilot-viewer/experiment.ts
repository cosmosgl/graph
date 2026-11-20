import { defineExperiment } from '../../runtime/experiment'
import { readStudyRecord } from '../../runtime/study-record'
import recordedSummary from './recorded-summary.json'
import { agentFindings } from './agent-findings'
import { cases } from './cases'
export const experiment = defineExperiment({
  id: 'pilot-viewer',
  title: 'Karate Club on WebGPU',
  summary: 'Find members, inspect neighbors and drag points while the 34-member graph runs on WebGPU.',
  tags: ['integration', 'interaction'],
  cases,
  study: { record: readStudyRecord(recordedSummary, 'pilot-viewer'), recipePage: 'agent-recipe', visualFirst: true, agentFindings },
  create: async host => (await import('./view')).createView(host),
  pages: [
    {
      kind: 'markdown',
      id: 'latency-evidence',
      title: 'Selection feedback evidence',
      load: async (): Promise<string> => (await import('./latency-evidence.md?raw')).default,
    },
    { kind: 'markdown', id: 'scope', title: 'First pilot contract', load: async (): Promise<string> => (await import('./scope.md?raw')).default },
    {
      kind: 'markdown',
      id: 'findings',
      title: 'Karate Club pilot findings',
      load: async (): Promise<string> => (await import('./findings.md?raw')).default,
    },
    {
      kind: 'markdown',
      id: 'agent-recipe',
      title: 'Investigate picking latency',
      load: async (): Promise<string> => (await import('./agent-recipe.md?raw')).default,
    },
  ],
})
