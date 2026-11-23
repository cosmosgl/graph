import { defineExperiment } from '../../runtime/experiment'
import { selectionCase } from './case'

export const experiment = defineExperiment({
  id: 'selection',
  title: 'Rectangle and lasso selection',
  summary: 'Draw a rectangle or lasso and compare the point IDs returned by WebGL and WebGPU.',
  tags: ['selection', 'interaction', 'WebGL', 'WebGPU'],
  presentation: 'demo',
  howItWorks: false,
  showRecordedSummary: false,
  headerContent: 'question-only',
  cases: [selectionCase],
  create: async host => (await import('./view')).createView(host),
  pages: [{
    kind: 'markdown',
    id: 'automated-cases',
    title: 'Automated test results',
    load: async (): Promise<string> => (await import('./automated-cases.md?raw')).default,
  }],
})
