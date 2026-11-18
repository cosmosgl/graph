import { readAgentFindings } from '../../runtime/agent-findings'
export const agentFindings = readAgentFindings(
  import.meta.glob<string>('./agent-findings/*.json', { query: '?raw', import: 'default', eager: true }), 'pilot-viewer'
)
