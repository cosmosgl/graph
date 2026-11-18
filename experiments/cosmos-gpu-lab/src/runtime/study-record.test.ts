import { expect, it } from 'vitest'
import precision from '../experiments/precision-diagnostics/recorded-summary.json'
import viewer from '../experiments/viewer-comparison/recorded-summary.json'
import { readStudyRecord } from './study-record'

it('keeps recorded mixed outcomes and unknown revisions explicit', () => {
  const result = readStudyRecord(viewer, 'viewer-comparison')
  expect(result.sourceRevision).toBeNull()
  expect(result.checks.map(check => check.outcome)).toContain('Pass')
  expect(result.checks.map(check => check.outcome)).toContain('Fail')
  expect(readStudyRecord(precision, 'precision-diagnostics').checks.every(check => check.outcome === 'Measured only')).toBe(true)
  expect(() => readStudyRecord({ ...viewer, experiment: 'wrong' }, 'viewer-comparison')).toThrow()
  expect(() => readStudyRecord({ ...viewer, checks: [{ name: 'Colors', outcome: 'Approved', detail: 'Unknown' }] }, 'viewer-comparison')).toThrow()
})
