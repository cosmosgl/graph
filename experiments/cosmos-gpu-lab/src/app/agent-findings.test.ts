import { expect, it } from 'vitest'
import { agentFindings } from '../experiments/precision-diagnostics/agent-findings'
import { experiment } from '../experiments/precision-diagnostics/experiment'
import { renderAgentFindings } from './agent-findings'

it('reports invalid records without hiding valid findings or interpreting their text as markup', () => {
  const record = { ...agentFindings.records[0], result: '<img src=x onerror=alert(1)>' }
  const invalid = ['./broken.json', './agent-findings/missing-evidence.json']
  const study = { ...experiment.study!, agentFindings: { records: [record], invalid } }
  const section = renderAgentFindings({ ...experiment, study })!
  const warning = section.querySelector('[role="status"]')!
  expect(warning.textContent).toContain('could not be displayed')
  for (const path of invalid) expect(warning.textContent).toContain(path)
  expect(section.textContent).toContain(record.result)
  expect(section.querySelector('img')).toBeNull()
})
