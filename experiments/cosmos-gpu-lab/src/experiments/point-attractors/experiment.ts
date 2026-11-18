import { defineExperiment } from '../../runtime/experiment'
import { readStudyRecord } from '../../runtime/study-record'
import { readAgentFindings } from '../../runtime/agent-findings'
import summary from './recorded-summary.json'
export const experiment = defineExperiment({
  id: 'point-attractors',
  title: 'Per-point attractors',
  summary: 'Compare production per-point targets and strengths with corrected WebGPU attraction and an independent CPU reference.',
  tags: ['simulation', 'attractors'],
  study: {
    record: readStudyRecord(summary, 'point-attractors'),
    recipePage: 'agent-recipe',
    visualFirst: true,
    agentFindings: readAgentFindings(import.meta.glob<string>('./agent-findings/*.json', { query: '?raw', import: 'default', eager: true }), 'point-attractors'),
  },
  create: async host => (await import('./view')).createView(host),
  pages: [
    { kind: 'markdown', id: 'method', title: 'How per-point attraction works', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'Attractor findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
    { kind: 'markdown', id: 'agent-recipe', title: 'Reproduce the attractor study', load: async (): Promise<string> => (await import('./agent-recipe.md?raw')).default },
  ],
})
