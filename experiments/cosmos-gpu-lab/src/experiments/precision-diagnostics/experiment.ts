import { defineExperiment } from '../../runtime/experiment'
import { readStudyRecord } from '../../runtime/study-record'
import { precisionCases } from './cases'
import recordedSummary from './recorded-summary.json'

export const experiment = defineExperiment({
  id: 'precision-diagnostics',
  title: 'Precision diagnostics',
  summary: 'Explore how addition order and gravity calculations affect numerical results.',
  tags: ['validation', 'precision', 'WebGL', 'WebGPU'],
  cases: precisionCases,
  study: { record: readStudyRecord(recordedSummary, 'precision-diagnostics'), recipePage: 'agent-recipe' },
  create: async (host, caseId) => (await import('./view')).createPrecisionView(host, caseId),
  pages: [{
    kind: 'markdown',
    id: 'method',
    title: 'Method and findings',
    load: async (): Promise<string> => (await import('./method.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'addition-evidence',
    title: 'Addition-order evidence',
    load: async (): Promise<string> => (await import('./addition-evidence.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'gravity-evidence',
    title: 'Gravity accuracy evidence',
    load: async (): Promise<string> => (await import('./gravity-evidence.md?raw')).default,
  }, {
    kind: 'markdown',
    id: 'agent-recipe',
    title: 'Reproduce with an agent',
    load: async (): Promise<string> => (await import('./agent-recipe.md?raw')).default,
  }],
})
