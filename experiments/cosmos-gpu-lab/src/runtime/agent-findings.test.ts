import { expect, it } from 'vitest'
import { agentFindings } from '../experiments/precision-diagnostics/agent-findings'
import { readAgentFindings } from './agent-findings'

const finding = {
  schemaVersion: 1,
  experiment: 'precision-diagnostics',
  status: 'complete',
  recordedAt: '2026-11-18',
  question: 'What happened?',
  result: 'A measured result.',
  limits: 'One device.',
  environment: 'Reported adapter.',
  evidence: 'The local capture contains the observations.',
  source: { revision: 'a'.repeat(40), state: 'clean', snapshot: null },
  reproduction: ['Repeat the recorded test.'],
}

it('loads the checked-in precision findings without manual registration', () => {
  expect(agentFindings.invalid).toEqual([])
  expect(agentFindings.records.map(record => record.id)).toContain('input-order')
})

it('keeps valid and incomplete findings while reporting invalid files', () => {
  const incomplete = { ...finding, status: 'incomplete', source: { revision: null, state: 'unknown', snapshot: null } }
  const missingSnapshot = { ...finding, source: { revision: 'a'.repeat(40), state: 'modified', snapshot: null } }
  const files = Object.fromEntries([
    ['./findings/completed.json', JSON.stringify(finding)],
    ['./findings/incomplete.json', JSON.stringify(incomplete)],
    ['./findings/newer.json', JSON.stringify({ ...finding, recordedAt: '2026-11-19' })],
    ['./findings/missing-snapshot.json', JSON.stringify(missingSnapshot)],
    ['./findings/missing-evidence.json', JSON.stringify({ ...finding, evidence: '' })],
    ['./findings/broken.json', '{'],
    ['./findings/wrong-experiment.json', JSON.stringify({ ...finding, experiment: 'other' })],
  ])
  const result = readAgentFindings(files, 'precision-diagnostics')
  expect(result.records.map(record => record.id)).toEqual(['newer', 'completed', 'incomplete'])
  expect(result.records.find(record => record.id === 'incomplete')!.status).toBe('incomplete')
  expect(result.invalid).toEqual([
    './findings/missing-snapshot.json', './findings/missing-evidence.json', './findings/broken.json', './findings/wrong-experiment.json',
  ])
})
