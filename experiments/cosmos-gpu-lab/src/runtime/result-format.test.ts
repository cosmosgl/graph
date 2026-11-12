import { expect, it } from 'vitest'
import { checkResult, count, milliseconds, scientific } from './result-format'

it('separates unchecked, unavailable, failed and successful checks', () => {
  expect([checkResult(undefined), checkResult(undefined, true), checkResult(false), checkResult(true)])
    .toEqual(['Unchecked', 'Unavailable', 'Fail', 'Pass'])
})

it('preserves tiny positive measurements and exposes missing or non-finite values', () => {
  expect(milliseconds(0.00004)).toBe('4.00e-5')
  expect(milliseconds(0)).toBe('0.000')
  expect(milliseconds(1.23456)).toBe('1.235')
  expect(milliseconds(null)).toBe('Unavailable')
  expect(scientific(NaN)).toBe('Non-finite')
  expect(scientific(undefined)).toBe('Unavailable')
  expect(count(8192)).toBe('8,192')
})
