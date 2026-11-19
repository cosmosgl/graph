import { frameFor, cellOf } from '../many-body-grid/data'
import type { Input } from '../many-body/data'
import { createResidentChain, type Distribution } from '../many-body-grid/resident-graph'

export const checkpoints = [1, 10, 50, 100, 200]
export const bins = 96
const sampleCount = 4096
export type LayoutSample = { box: Float32Array; side: number; density: Uint32Array; sample: Float32Array }
type EdgeInput = { input: Input; probes: Array<{ n: number; axis: number; id: number }> }
type EdgeResult = { n: number; pairs: number; controlJumpP95: number; extraJumpP95: number; maxExtra: number }

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

export function layoutSample (positions: Float32Array, tick: number, controlBox?: Float32Array, sampleEnd = positions.length / 4): LayoutSample {
  const box = controlBox ?? frameFor(positions, tick - 1).bounds
  const side = box[2] * 1.1; const x0 = box[0] - box[2] * 0.05; const y0 = box[1] - box[2] * 0.05
  const density = new Uint32Array(bins * bins + 1); const sample = new Float32Array(sampleCount * 2)
  for (let i = 0; i < positions.length; i += 4) {
    if (positions[i + 3]) continue
    const x = Math.floor((positions[i] - x0) * bins / side); const y = Math.floor((positions[i + 1] - y0) * bins / side)
    density[x >= 0 && x < bins && y >= 0 && y < bins ? y * bins + x : bins * bins]++
  }
  // Exclude the known pinned and absent IDs from the displacement sample.
  for (let j = 0; j < sampleCount; j++) {
    const i = (2 + Math.floor(j * (sampleEnd - 2) / sampleCount)) * 4
    sample[j * 2] = positions[i]; sample[j * 2 + 1] = positions[i + 1]
  }
  return { box, side, density, sample }
}

export function layoutDifference (actual: LayoutSample, control: LayoutSample): {
  medianPx: number; p95Px: number; maxPx: number; densityDifferencePercent: number; outsideDensitySquare: number;
} {
  const shifts: number[] = []; let binDiff = 0; let total = 0
  for (let i = 0; i < actual.sample.length; i += 2) {
    shifts.push(340 / control.side * Math.hypot(actual.sample[i] - control.sample[i], actual.sample[i + 1] - control.sample[i + 1]))
  }
  for (const [i, count] of control.density.entries()) { total += count; binDiff += Math.abs(count - actual.density[i]) }
  return {
    medianPx: percentile(shifts, 0.5),
    p95Px: percentile(shifts, 0.95),
    maxPx: Math.max(...shifts),
    densityDifferencePercent: 100 * binDiff / (2 * total),
    outsideDensitySquare: actual.density[bins * bins],
  }
}

// The anchors fix the bounds before probes are inserted. Odd grid lines give
// each edge a unique coarsest level. Only this frozen diagnostic adds probes.
export function edgeInput (distribution: Distribution): EdgeInput {
  const { input } = createResidentChain(1000000, distribution); const points = input.points
  points.set([-64, -64], 8); points.set([64, 64], 12)
  const box = frameFor(points, 0).bounds
  const probes: Array<{ n: number; axis: number; id: number }> = []
  for (const n of [8, 16, 32, 64]) {
    const size = box[2] / n
    for (const axis of [0, 1]) {
      const crossCoordinates = axis === 0 ? [-51.37, -12.83, 0.27, 16.39, 53.21] : [-52.73, -24.19, 0.27, 24.21, 53.27]
      for (let line = 1; line < n; line += 2) {
        const edge = box[axis] + size * line
        if (Math.abs(edge) + size * 0.0001 >= 64) continue
        for (const other of crossCoordinates) {
          const id = 4 + probes.length * 2; probes.push({ n, axis, id })
          for (const j of [0, 1]) {
            const value = edge + (j * 2 - 1) * size * 0.0001
            points.set(axis ? [other, value] : [value, other], (id + j) * 4)
            input.samples.fill(0, (id + j) * 2, (id + j + 1) * 2)
          }
        }
      }
    }
  }
  return { input, probes }
}

export function edgeDifferences (fixture: EdgeInput, box: Float32Array, forces: Float32Array, reference: Float32Array): EdgeResult[] {
  const { probes, input } = fixture
  return [8, 16, 32, 64].map(n => {
    const excess: number[] = []; const baseline: number[] = []
    for (const { n: level, axis, id } of probes) {
      if (level !== n) continue
      const a = id * 4; const b = a + 4; const points = input.points
      const left = cellOf(points[a], points[a + 1], n, box); const right = cellOf(points[b], points[b + 1], n, box)
      if (right - left !== (axis ? n : 1)) throw new Error('Probe pair did not straddle the intended GPU cell edge')
      const dx = reference[b] - reference[a]; const dy = reference[b + 1] - reference[a + 1]
      baseline.push(Math.hypot(dx, dy))
      excess.push(Math.hypot(forces[b] - forces[a] - dx, forces[b + 1] - forces[a + 1] - dy))
    }
    return { n, pairs: excess.length, controlJumpP95: percentile(baseline, 0.95), extraJumpP95: percentile(excess, 0.95), maxExtra: Math.max(...excess) }
  })
}
