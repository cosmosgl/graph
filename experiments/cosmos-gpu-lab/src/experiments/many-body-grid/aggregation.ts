import { replaceOnce } from './trace'
import { layout, buildReference, type Frame } from './data'
export type AggregationMode = 'baseline' | 'cached-cells' | 'cached-small'
export const aggregationLimit = (mode: AggregationMode): number => mode === 'cached-small' ? 32 : 128

// Cache INTEGER membership already calculated by binning. Dense cells still
// accumulate source positions sequentially in ascending source-index order.
export function cachedCellShader (shader: string, limit = 128): string {
  if (limit !== 32 && limit !== 128) throw new Error('Expected 32 or 128 sort indices')
  let source = replaceOnce(shader,
    'if (i >= count || positions[i].w > 0.5) { return; }',
    `if (i >= count) { return; }
  if (positions[i].w > 0.5) {
    for (var level = 0u; level < u32(params.levelCount); level++) { pointCells[level * count + i] = EMPTY; }
    return;
  }`)
  source = replaceOnce(source,
    'links[level * count + i] = atomicExchange(&heads[key], i);',
    'pointCells[level * count + i] = key;\n    links[level * count + i] = atomicExchange(&heads[key], i);')
  source = replaceOnce(source,
    `    let n = levels[level].x; let localCell = cell - levels[level].y;
    for (var i = 0u; i < u32(params.count); i++) {
      if (positions[i].w > 0.5) { continue; }
      let c = gridCell(positions[i].xy, n);
      if (c.y * n + c.x == localCell) { sum += vec4(positions[i].xy, 1., 0.); }
    }`,
    `    for (var i = 0u; i < u32(params.count); i++) {
      if (pointCells[level * u32(params.count) + i] == cell) { sum += vec4(positions[i].xy, 1., 0.); }
    }`)
  if (limit !== 128) {
    const start = source.indexOf('@compute @workgroup_size(64)\nfn aggregate(')
    const end = source.indexOf('@compute @workgroup_size(64)\nfn selectSlots(')
    if (start < 0 || end < start) throw new Error('Aggregate shader markers changed')
    const before = source.slice(start, end)
    let aggregate = replaceOnce(before, 'array<u32,128>', `array<u32,${limit}>`)
    aggregate = replaceOnce(aggregate, 'occupancy < 128u', `occupancy < ${limit}u`)
    aggregate = replaceOnce(aggregate, 'occupancy <= 128u', `occupancy <= ${limit}u`)
    aggregate = replaceOnce(aggregate, 'occupancy++; point = links[level * u32(params.count) + point];',
      `occupancy++; if (occupancy > ${limit}u) { break; } point = links[level * u32(params.count) + point];`)
    source = replaceOnce(source, before, aggregate)
  }
  return `${source}\n@group(0) @binding(15) var<storage, read_write> pointCells: array<u32>;\n`
}

// Explain the existing path selection on the exact post-gravity input. These
// are deterministic operation counts, not a GPU timing or hardware attribution.
export function aggregationWork (points: Float32Array, frame: Frame, limit = 128): Array<{
  grid: number; cells: number; empty: number; occupied: number; dense: number; maxOccupancy: number; denseSourceTests: number;
}> {
  const l = layout(points.length / 4); const { aggregates } = buildReference(points, frame)
  return l.sizes.map((grid, level) => {
    let occupied = 0; let dense = 0; let maxOccupancy = 0
    for (let cell = 0; cell < grid * grid; cell++) {
      const n = aggregates[(l.offsets[level] + cell) * 4 + 2]
      if (n) occupied++
      if (n > limit) dense++
      maxOccupancy = Math.max(maxOccupancy, n)
    }
    return { grid, cells: grid * grid, empty: grid * grid - occupied, occupied, dense, maxOccupancy, denseSourceTests: dense * points.length / 4 }
  })
}
