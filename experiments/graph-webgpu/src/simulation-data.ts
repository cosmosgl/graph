import type { Store } from '../../../src/modules/Store'
import { toFiniteCoordinate } from '../../../src/modules/Points/position-utils'

/** The WebGL initial-layout rule, evaluated without writing into caller-owned arrays. */
export function positionScales (xy: Float32Array, store: Store): {
  x?: (value: number) => number;
  y?: (value: number) => number;
} {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (let i = 0; i < xy.length; i += 2) {
    const x = xy[i]!; const y = xy[i + 1]!
    if (Number.isNaN(x) || Number.isNaN(y)) continue
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const width = maxX - minX; const height = maxY - minY
  const extent = Math.max(width, height)
  const space = store.referenceLength
  if (!Number.isFinite(extent) || extent > space) return {}
  const [centerX, centerY] = store.worldOrigin
  if (extent === 0) return { x: x => x - minX + centerX, y: y => y - minY + centerY }
  const count = xy.length / 2
  const side = count > space * space * 0.001 ? space * Math.max(1.2, Math.sqrt(count) / space) : space * 0.1
  const scale = side / extent
  const offsetX = (extent - width) / 2 * scale + (centerX - side / 2)
  const offsetY = (extent - height) / 2 * scale + (centerY - side / 2)
  return { x: x => (x - minX) * scale + offsetX, y: y => (y - minY) * scale + offsetY }
}

export function writePosition (packed: Float32Array, at: number, x: number, y: number, pinned: boolean, edge: number): void {
  const absent = Number.isNaN(x) || Number.isNaN(y)
  // A snapped absence has no prior location. An animated exit can retain its
  // last finite location for restoration; the fourth lane excludes both from queries and forces.
  packed[at] = absent ? NaN : toFiniteCoordinate(x, edge)
  packed[at + 1] = absent ? NaN : toFiniteCoordinate(y, edge)
  packed[at + 2] = Number(pinned)
  packed[at + 3] = Number(absent)
}

export function unpackPositions (packed: Float32Array, out?: Float32Array): Float32Array {
  const length = packed.length / 2
  const result = out && out.length >= length ? out : new Float32Array(length)
  for (let i = 0; i < packed.length / 4; i++) {
    const missing = packed[4 * i + 3]! > 0.5
    result[2 * i] = missing ? NaN : packed[4 * i]!
    result[2 * i + 1] = missing ? NaN : packed[4 * i + 1]!
  }
  return result
}
