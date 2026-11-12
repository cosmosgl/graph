// Display conventions only. Raw exports and numerical acceptance use original values.
export function scientific (value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return 'Unavailable'
  return Number.isFinite(value) ? value.toExponential(digits) : 'Non-finite'
}

export function milliseconds (value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable'
  if (!Number.isFinite(value)) return 'Non-finite'
  // Preserve positive sub-microsecond values instead of rounding them to zero.
  return value !== 0 && Math.abs(value) < 0.001 ? value.toExponential(2) : value.toFixed(3)
}

export function count (value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

export function checkResult (valid: boolean | undefined, unavailable = false): string {
  return unavailable ? 'Unavailable' : valid === undefined ? 'Unchecked' : valid ? 'Pass' : 'Fail'
}

export function yesNo (value: boolean): string { return value ? 'Yes' : 'No' }
