import type { ReductionCenter } from './backend'

export const CPU_REFERENCE_LIMIT = 1_000_000
export const ROTATION_COSINE = 0.999998
export const ROTATION_SINE = 0.0019999987

function hashU32 (value: number): number {
  let result = value >>> 0
  result = (result ^ (result >>> 16)) >>> 0
  result = Math.imul(result, 0x7feb352d) >>> 0
  result = (result ^ (result >>> 15)) >>> 0
  result = Math.imul(result, 0x846ca68b) >>> 0
  return (result ^ (result >>> 16)) >>> 0
}

function coordinate (value: number): number {
  const hashed = Math.fround(hashU32(value))
  const normalized = Math.fround(hashed / 4_294_967_295)
  return Math.fround(Math.fround(normalized * 1.8) - 0.9)
}

export function createInitialPositions (pointCount: number): Float32Array {
  const positions = new Float32Array(pointCount * 2)
  for (let index = 0; index < pointCount; index += 1) {
    positions[index * 2] = coordinate(index * 2 + 0x9e3779b9)
    positions[index * 2 + 1] = coordinate(index * 2 + 1 + 0x9e3779b9)
  }
  return positions
}

export function calculateInitialCpuCenter (pointCount: number): ReductionCenter | undefined {
  if (pointCount > CPU_REFERENCE_LIMIT) return undefined
  let x = 0
  let y = 0
  for (let index = 0; index < pointCount; index += 1) {
    x += coordinate(index * 2 + 0x9e3779b9)
    y += coordinate(index * 2 + 1 + 0x9e3779b9)
  }
  return { x: x / pointCount, y: y / pointCount, count: pointCount }
}

export function rotateCpuCenter (center: ReductionCenter): ReductionCenter {
  return {
    x: center.x * ROTATION_COSINE - center.y * ROTATION_SINE,
    y: center.x * ROTATION_SINE + center.y * ROTATION_COSINE,
    count: center.count,
  }
}
