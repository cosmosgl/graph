export type PointDistribution = 'uniform' | 'clusters' | 'diagonal'

export type CpuGridReference = {
  counts: Uint32Array;
  offsets: Uint32Array;
  occupiedCells: number;
  maximumCellLoad: number;
}

export type GridValidation = {
  valid: boolean;
  countMismatches: number;
  offsetMismatches: number;
  invalidMemberships: number;
  duplicateIndices: number;
  missingIndices: number;
}

function hashU32 (value: number): number {
  let result = value >>> 0
  result = (result ^ (result >>> 16)) >>> 0
  result = Math.imul(result, 0x7feb352d) >>> 0
  result = (result ^ (result >>> 15)) >>> 0
  result = Math.imul(result, 0x846ca68b) >>> 0
  return (result ^ (result >>> 16)) >>> 0
}

function unitValue (value: number): number {
  return hashU32(value) / 4_294_967_295
}

export function createGridPositions (
  pointCount: number,
  distribution: PointDistribution
): Float32Array {
  const positions = new Float32Array(pointCount * 2)
  for (let index = 0; index < pointCount; index += 1) {
    const first = unitValue(index * 4 + 0x9e3779b9)
    const second = unitValue(index * 4 + 0x85ebca6b)
    let x = first * 2 - 1
    let y = second * 2 - 1

    if (distribution === 'clusters') {
      const cluster = hashU32(index + 0xc2b2ae35) % 8
      const angle = cluster / 8 * Math.PI * 2
      const radius = 0.55 + (cluster % 2) * 0.18
      x = Math.cos(angle) * radius + (first - 0.5) * 0.22
      y = Math.sin(angle) * radius + (second - 0.5) * 0.22
    } else if (distribution === 'diagonal') {
      x = first * 2 - 1
      y = x + (second - 0.5) * 0.035
    }

    positions[index * 2] = Math.max(-0.999999, Math.min(0.999999, x))
    positions[index * 2 + 1] = Math.max(-0.999999, Math.min(0.999999, y))
  }
  return positions
}

export function pointCell (
  positions: Float32Array,
  pointIndex: number,
  gridSize: number
): number {
  const mapCoordinate = (value: number): number => {
    // Match WGSL's f32 operations at cell boundaries instead of using JS f64 intermediates.
    const normalized = Math.fround(Math.fround(value * 0.5) + 0.5)
    return Math.min(gridSize - 1, Math.max(0,
      Math.floor(Math.fround(normalized * gridSize))))
  }
  const x = mapCoordinate(positions[pointIndex * 2])
  const y = mapCoordinate(positions[pointIndex * 2 + 1])
  return y * gridSize + x
}

export function createCpuGridReference (
  positions: Float32Array,
  gridSize: number
): CpuGridReference {
  const pointCount = positions.length / 2
  const cellCount = gridSize * gridSize
  const counts = new Uint32Array(cellCount)
  for (let index = 0; index < pointCount; index += 1) {
    counts[pointCell(positions, index, gridSize)] += 1
  }

  const offsets = new Uint32Array(cellCount + 1)
  let occupiedCells = 0
  let maximumCellLoad = 0
  for (let cell = 0; cell < cellCount; cell += 1) {
    offsets[cell + 1] = offsets[cell] + counts[cell]
    if (counts[cell] > 0) occupiedCells += 1
    maximumCellLoad = Math.max(maximumCellLoad, counts[cell])
  }
  return { counts, offsets, occupiedCells, maximumCellLoad }
}

export function validateGrid (
  positions: Float32Array,
  gridSize: number,
  reference: CpuGridReference,
  counts: Uint32Array,
  offsets: Uint32Array,
  pointIndices: Uint32Array
): GridValidation {
  const pointCount = positions.length / 2
  const cellCount = gridSize * gridSize
  let countMismatches = 0
  let offsetMismatches = 0
  let invalidMemberships = 0
  let duplicateIndices = 0
  let missingIndices = 0

  for (let cell = 0; cell < cellCount; cell += 1) {
    if (counts[cell] !== reference.counts[cell]) countMismatches += 1
    if (offsets[cell] !== reference.offsets[cell]) offsetMismatches += 1
  }
  if (offsets[cellCount] !== pointCount) offsetMismatches += 1

  const seen = new Uint8Array(pointCount)
  for (let cell = 0; cell < cellCount; cell += 1) {
    const end = Math.min(pointCount, offsets[cell] + counts[cell])
    for (let cursor = offsets[cell]; cursor < end; cursor += 1) {
      const pointIndex = pointIndices[cursor]
      if (pointIndex >= pointCount || pointCell(positions, pointIndex, gridSize) !== cell) {
        invalidMemberships += 1
        continue
      }
      if (seen[pointIndex]) duplicateIndices += 1
      seen[pointIndex] = 1
    }
  }
  for (const value of seen) {
    if (!value) missingIndices += 1
  }

  return {
    valid: countMismatches === 0 && offsetMismatches === 0 &&
      invalidMemberships === 0 && duplicateIndices === 0 && missingIndices === 0,
    countMismatches,
    offsetMismatches,
    invalidMemberships,
    duplicateIndices,
    missingIndices,
  }
}
