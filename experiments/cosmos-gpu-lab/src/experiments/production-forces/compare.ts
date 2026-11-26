import { absentIndex, combinedDiameters, combinedLinks, combinedPadding } from './fixture'

type PositionStats = { different: number; maxDelta: number; rmsDelta: number; radius: number; cx: number; cy: number }

/** Exclude only the fixture's deliberately absent slot. An unexpected NaN is a failed read. */
export function positionStats (positions: Float32Array, reference: Float32Array, hole = absentIndex): PositionStats {
  if (positions.length !== reference.length || positions.length % 2) throw new Error('Incompatible position arrays')
  const count = positions.length / 2 - 1
  let sumX = 0
  let sumY = 0
  let squaredError = 0
  let maxDelta = 0
  let different = 0
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i]
    const y = positions[i + 1]
    const rx = reference[i]
    const ry = reference[i + 1]
    if (i === 2 * hole) {
      if (![x, y, rx, ry].every(Number.isNaN)) throw new Error('The absent slot gained a position')
      continue
    }
    if (![x, y, rx, ry].every(Number.isFinite)) throw new Error(`Invalid position for point ${i / 2}`)
    const dx = x - rx
    const dy = y - ry
    sumX += x
    sumY += y
    squaredError += dx * dx + dy * dy
    maxDelta = Math.max(maxDelta, Math.abs(dx), Math.abs(dy))
    if (dx || dy) different++
  }
  const cx = sumX / count
  const cy = sumY / count
  let radiusSquared = 0
  for (let i = 0; i < positions.length; i += 2) {
    if (i !== 2 * hole) radiusSquared += (positions[i] - cx) ** 2 + (positions[i + 1] - cy) ** 2
  }
  return { different, maxDelta, rmsDelta: Math.sqrt(squaredError / count), radius: Math.sqrt(radiusSquared / count), cx, cy }
}

/** Collision applies padding to each point's radius. All lengths are world-space graph units. */
export function combinedMetrics (positions: Float32Array): { penetration: number; linkLengths: number[] } {
  function distance (a: number, b: number): number {
    return Math.hypot(positions[2 * a] - positions[2 * b], positions[2 * a + 1] - positions[2 * b + 1])
  }
  const contact = (combinedDiameters[1] + combinedDiameters[2]) / 2 + 2 * combinedPadding
  const linkLengths = [0, 1].map(id => distance(combinedLinks[2 * id], combinedLinks[2 * id + 1]))
  return { penetration: Math.max(0, contact - distance(1, 2)), linkLengths }
}
