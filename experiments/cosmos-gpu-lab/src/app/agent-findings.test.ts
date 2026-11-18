import { expect, it } from 'vitest'
import { agentFindings } from '../experiments/precision-diagnostics/agent-findings'
import { experiment } from '../experiments/precision-diagnostics/experiment'
import { renderAgentFindings } from './agent-findings'

it('reports invalid records without hiding valid findings or interpreting their text as markup', () => {
  const record = { ...agentFindings.records[0], result: '<img src=x onerror=alert(1)>' }
  const study = { ...experiment.study!, agentFindings: { records: [record], invalid: ['./broken.json'] } }
  const section = renderAgentFindings({ ...experiment, study })!
  expect(section.querySelector('[role="status"]')?.textContent).toContain('could not be displayed')
  expect(section.textContent).toContain(record.result)
  expect(section.querySelector('img')).toBeNull()
})
