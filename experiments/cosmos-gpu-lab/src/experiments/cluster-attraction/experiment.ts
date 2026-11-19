import { defineExperiment } from '../../runtime/experiment'
import { readStudyRecord } from '../../runtime/study-record'
import { readAgentFindings } from '../../runtime/agent-findings'
import { cases } from './cases'
import summary from './recorded-summary.json'
export const experiment = defineExperiment({
  id: 'cluster-attraction',
  title: 'Cluster attraction',
  summary: 'Compare production cluster centroids and attraction with grouped WebGPU reduction and an independent CPU reference.',
  tags: ['simulation', 'clusters'],
  study: {
    record: readStudyRecord(summary, 'cluster-attraction'),
    recipePage: 'agent-recipe',
    visualFirst: true,
    agentFindings: readAgentFindings(import.meta.glob<string>('./agent-findings/*.json', { query: '?raw', import: 'default', eager: true }), 'cluster-attraction'),
  },
  cases,
  create: async host => (await import('./view')).createView(host),
  pages: [
    { kind: 'markdown', id: 'method', title: 'How cluster attraction works', load: async (): Promise<string> => (await import('./method.md?raw')).default },
    { kind: 'markdown', id: 'findings', title: 'Cluster findings', load: async (): Promise<string> => (await import('./findings.md?raw')).default },
    { kind: 'markdown', id: 'agent-recipe', title: 'Reproduce the cluster study', load: async (): Promise<string> => (await import('./agent-recipe.md?raw')).default },
  ],
})
