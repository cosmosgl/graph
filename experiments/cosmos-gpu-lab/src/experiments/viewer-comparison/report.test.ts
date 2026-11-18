import { expect, test } from 'vitest'
import { report } from './report'
const pixels = { interiorIdFailures: 0, interiorColorFailures: 0, invisiblePicks: 0, finite: true, samples: 10 }
test('color differences remain failures even when IDs match', () => {
  expect(report({ pixelAudit: { ...pixels, interiorColorFailures: 1 } }).verdict).toBe('Fail')
  expect(report({ pixelAudit: pixels }).verdict).toBe('Pass')
})
test('invisible picks in either renderer reject paired paint', () => {
  const r = { ...pixels, invisiblePicks: undefined, candidateInvisiblePicks: 0, productionInvisiblePicks: 1, nonempty: true }
  expect(report(r).verdict).toBe('Fail')
  expect(report({ ...r, productionInvisiblePicks: 0, candidateInvisiblePicks: 1 }).verdict).toBe('Fail')
})
test('an asynchronous uncompleted resize cannot pass update validation', () => {
  const r = {
    action: 'updates',
    finite: true,
    glSizes: true,
    glColors: true,
    gpuStyles: true,
    glCount: 34,
    gpuCount: 34,
    attachments: [[944, 640], [944, 560]],
    candidatePixels: pixels,
  }
  expect(report(r).verdict).toBe('Fail')
  expect(report({ ...r, attachments: [[944, 560], [944, 560]] }).verdict).toBe('Pass')
})
test('finite layout stress is an observation, not quality approval', () => {
  expect(report({ checkpoint: 5000, actualTick: 5000, stress: 0.28, finite: true }).verdict).toBe('Recorded')
})
