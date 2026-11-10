import { compareArray } from '../many-body/reference'
import type { Structure } from './data'
export function compareStructure (actual: Structure, expected: Structure): {
  valid: boolean; aggregates: ReturnType<typeof compareArray>; slotMismatches: number; maxHashError: number;
} {
  const aggregates = compareArray(actual.aggregates, expected.aggregates)
  let slotMismatches = 0; let maxHashError = 0
  if (actual.slots.length !== expected.slots.length) slotMismatches++
  for (let i = 0; i < expected.slots.length; i += 2) {
    if (actual.slots[i] !== expected.slots[i]) slotMismatches++
    const error = Math.abs(actual.slots[i + 1] - expected.slots[i + 1])
    maxHashError = Math.max(maxHashError, Number.isFinite(error) ? error : Infinity)
  }
  // Hash arithmetic can differ by rounding; selected point identities must be exact.
  return { valid: aggregates.valid && slotMismatches === 0 && maxHashError <= 2e-7, aggregates, slotMismatches, maxHashError }
}
