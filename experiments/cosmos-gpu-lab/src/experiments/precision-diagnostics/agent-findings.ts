import { readAgentFindings } from '../../runtime/agent-findings'

// Each JSON file is a separate finding; adding one needs no page or registry edit.
export const agentFindings = readAgentFindings(
  import.meta.glob<string>('./agent-findings/*.json', { query: '?raw', import: 'default', eager: true }),
  'precision-diagnostics'
)
