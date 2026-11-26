import { defineExperiment } from '../../runtime/experiment'
import type { LiveCheckGroup } from '../../runtime/live-checks'
import { selectionCase } from './case'

export const experiment = defineExperiment({
  id: 'selection',
  title: 'Rectangle and lasso selection in v3.6.0',
  summary: 'Compare the historical WebGL v3.6.0 selection rules with the isolated WebGPU implementation.',
  tags: ['selection', 'interaction', 'WebGL', 'WebGPU'],
  presentation: 'demo',
  howItWorks: false,
  showRecordedSummary: false,
  headerContent: 'question-only',
  cases: [selectionCase],
  create: async host => (await import('./view')).createView(host),
  pages: [{
    kind: 'live-checks',
    id: 'automated-cases',
    title: 'Automated test results',
    load: async (): Promise<LiveCheckGroup[]> => (await import('./suite')).selectionGroups,
  }],
})
