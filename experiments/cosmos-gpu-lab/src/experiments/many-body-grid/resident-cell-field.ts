import { type Layout } from './data'
import { replaceOnce } from './trace'
import cellField from './resident-cell-field.wgsl?raw'

export type DistantForce = 'per-point' | 'cell-center' | 'four-corners'

export function fieldLayout (grid: Layout, mode: DistantForce, coarseLevels = 4): { levels: number; cells: number; rows: number } {
  if (!Number.isInteger(coarseLevels) || coarseLevels < 1) throw new Error('Expected a positive number of shared levels')
  // Always keep the finest level and its sampled neighbors individual.
  const levels = mode === 'per-point' ? 0 : Math.min(coarseLevels, grid.sizes.length - 1)
  return { levels, cells: grid.offsets[levels], rows: mode === 'four-corners' ? 2 : 1 }
}

export function withCellField (source: string, cachedLevels: number, corners: boolean): string {
  // Evaluate the very same source-cell stencil at a different target position.
  // The target cell that owns the stencil stays fixed, even at its upper corners.
  const start = source.indexOf('    let shell =', source.indexOf('fn forceMain('))
  const end = source.indexOf('    far += velocity;', start)
  if (start < 0 || end < start) throw new Error('Resident far-field loop changed')
  const shell = replaceOnce(source.slice(start, end),
    'farScratch[local] = pairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z); velocity += farScratch[local];',
    'velocity += pairVelocity(samplePosition - centroids[cellIndex].xy, vec2(0.), a.z);')
  const pointLoop = replaceOnce(source,
    '  var far = vec2(0.);\n  for (var level = 0u; level < u32(params.levelCount); level++)',
    '  var far = readCellField(point.xy);\n  for (var level = cachedLevels; level < u32(params.levelCount); level++)')
  return `${pointLoop}
const cachedLevels = ${cachedLevels}u;
const fourCorners = ${corners};
fn shellPush(level: u32, n: u32, cell: vec2i, samplePosition: vec2f) -> vec2f {
${shell}
  return velocity;
}
${cellField}`
}
