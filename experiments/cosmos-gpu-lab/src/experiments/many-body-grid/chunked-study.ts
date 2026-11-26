import { cellOf, layout, type Frame } from './data'
import { DEFAULT_FAR_CHUNK_SIZE } from './far-resources'

export type GridBufferPlan = { name: string; bytes: number }
export function gridBufferPlan (count: number, chunkSize = DEFAULT_FAR_CHUNK_SIZE, samples = 8): {
  count: number; chunkSize: number; samples: number; levels: number[]; cells: number; buffers: GridBufferPlan[]; totalBytes: number;
  oldScratchBytes: number; chunkScratchBytes: number;
} {
  if (![count, chunkSize, samples].every(n => Number.isSafeInteger(n) && n > 0) || samples > 64) {
    throw new Error('Invalid grid memory-plan inputs')
  }
  const l = layout(count); const levels = l.sizes.length; const scratch = Math.min(count, chunkSize) * 100 * 8
  // Major simulation buffers only: no graph links/springs, canvas, device/driver
  // overhead, GPU bounds partials, small uniforms or temporary readback buffers.
  const buffers = [
    { name: 'positions-a', bytes: count * 16 },
    { name: 'positions-b', bytes: count * 16 },
    { name: 'random-samples', bytes: count * 8 },
    { name: 'forces', bytes: count * 16 },
    { name: 'cell-linked-lists', bytes: count * levels * 4 },
    { name: 'cached-cell-membership', bytes: count * levels * 4 },
    { name: 'cell-heads', bytes: l.cells * 4 },
    { name: 'cell-aggregates', bytes: l.cells * 16 },
    { name: 'cell-centroids', bytes: l.cells * 16 },
    { name: 'near-sample-slots', bytes: l.finest * l.finest * samples * 8 },
    { name: 'far-contribution-scratch', bytes: scratch },
    { name: 'far-cumulative-sums', bytes: count * levels * 8 },
  ]
  return {
    count,
    chunkSize,
    samples,
    levels: l.sizes,
    cells: l.cells,
    buffers,
    totalBytes: buffers.reduce((sum, buffer) => sum + buffer.bytes, 0),
    oldScratchBytes: count * 100 * 8,
    chunkScratchBytes: scratch,
  }
}

// The existing dense aggregation fallback loops over every source for each
// cell above the chosen sort threshold. This counts those loop iterations,
// not GPU execution time, using the CPU reference's cell assignment for the
// same input and frame. GPU rounding at cell boundaries may differ.
export function denseScanWork (points: Float32Array, frame: Frame, thresholds = [32, 128]): Array<{
  grid: number; occupied: number; maxOccupancy: number; byThreshold: Array<{ threshold: number; denseCells: number; sourceIterations: number }>;
}> {
  if (points.length % 4) throw new Error('Expected point vec4s')
  const count = points.length / 4; const l = layout(count)
  const counts = new Uint32Array(l.cells)
  for (let i = 0; i < count; i++) {
    if (points[i * 4 + 3] > 0.5) continue
    for (let level = 0; level < l.sizes.length; level++) {
      counts[l.offsets[level] + cellOf(points[i * 4], points[i * 4 + 1], l.sizes[level], frame.bounds)]++
    }
  }
  return l.sizes.map((grid, level) => {
    let occupied = 0; let maxOccupancy = 0
    const dense = thresholds.map(() => 0)
    for (let i = l.offsets[level]; i < l.offsets[level] + grid * grid; i++) {
      const n = counts[i]; if (n) occupied++; maxOccupancy = Math.max(maxOccupancy, n)
      thresholds.forEach((threshold, index) => { if (n > threshold) dense[index]++ })
    }
    return {
      grid,
      occupied,
      maxOccupancy,
      byThreshold: thresholds.map((threshold, index) => ({ threshold, denseCells: dense[index], sourceIterations: dense[index] * count })),
    }
  })
}
