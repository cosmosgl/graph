import { defineExperiment } from '../../runtime/experiment'
import { readStudyRecord } from '../../runtime/study-record'
import { agentFindings } from './agent-findings'
import recordedSummary from './recorded-summary.json'

export const experiment = defineExperiment({
  id: 'precision-diagnostics',
  title: 'Precision diagnostics',
  summary: 'Separate analytic gravity accuracy, legacy polar compatibility and cancellation in controlled GPU sums.',
  tags: ['validation', 'precision', 'WebGL', 'WebGPU'],
  study: { record: readStudyRecord(recordedSummary, 'precision-diagnostics'), recipePage: 'agent-recipe', agentFindings },
  create: async host => (await import('./view')).createPrecisionView(host),
  pages: [{
    kind: 'markdown',
    id: 'method',
    title: 'Method and findings',
    load: async (): Promise<string> => (await import('./method.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'agent-recipe',
    title: 'Reproduce with an agent',
    load: async (): Promise<string> => (await import('./agent-recipe.md?raw')).default,
  }],
})
