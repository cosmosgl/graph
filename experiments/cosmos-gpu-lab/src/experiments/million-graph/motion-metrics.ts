export function percentile (values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(fraction * sorted.length) - 1]
}

export function motionChecks (initial: Float32Array, positions: Float32Array): {
  nonfinite: number; flagErrors: number; fixedMoved: number; freeMoved: number;
} {
  let nonfinite = 0; let flagErrors = 0; let fixedMoved = 0; let freeMoved = 0
  for (let o = 0; o < positions.length; o += 4) {
    if (!Number.isFinite(positions[o]) || !Number.isFinite(positions[o + 1])) nonfinite++
    if (positions[o + 2] !== initial[o + 2] || positions[o + 3] !== initial[o + 3]) flagErrors++
    const moved = positions[o] !== initial[o] || positions[o + 1] !== initial[o + 1]
    if (initial[o + 2] || initial[o + 3]) { if (moved) fixedMoved++ } else if (moved) freeMoved++
  }
  return { nonfinite, flagErrors, fixedMoved, freeMoved }
}
