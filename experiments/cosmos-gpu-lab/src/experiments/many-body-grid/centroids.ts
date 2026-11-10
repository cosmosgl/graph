import division from './divide-by-count.wgsl?raw'
import { replaceOnce } from './trace'
import type { Structure } from './data'
export type CentroidMode = 'inline' | 'stored' | 'corrected' | 'materialized' | 'refined'
// A separate dispatch makes the rounded centroid a storage value before subtraction.
export function storedCentroidShader (shader: string, corrected = false): string {
  let source = replaceOnce(shader,
    'let a = aggregates[levels[level].y + u32(candidate.y) * n + u32(candidate.x)];',
    'let cellIndex = levels[level].y + u32(candidate.y) * n + u32(candidate.x);\n      let a = aggregates[cellIndex];')
  source = replaceOnce(source, 'point.xy - a.xy / a.z', 'point.xy - centroids[cellIndex].xy')
  return `${source}
${corrected ? division : ''}
@group(0) @binding(11) var<storage, read_write> centroids: array<vec4<f32>>;
@compute @workgroup_size(64)
fn centroidMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let cell = gid.x;
  if (cell >= u32(params.cellCount)) { return; }
  let a = aggregates[cell];
  var center = vec2(0.);
  if (a.z > 0.) { center = ${corrected ? 'vec2(divideByCount(a.x, u32(a.z)), divideByCount(a.y, u32(a.z)))' : 'a.xy / a.z'}; }
  centroids[cell] = vec4(center, a.z, 0.);
}
`
}
export function centroidReference (structure: Structure): Float32Array {
  const result = new Float32Array(structure.aggregates.length)
  for (let i = 0; i < result.length; i += 4) {
    const mass = structure.aggregates[i + 2]
    if (mass > 0) { result[i] = structure.aggregates[i] / mass; result[i + 1] = structure.aggregates[i + 1] / mass }
    result[i + 2] = mass
  }
  return result
}
export function centroidRounding (actual: Float32Array, expected: Float32Array): { differingComponents: number; maxUlp: number; maxError: number } {
  const bitsA = new Uint32Array(actual.buffer, actual.byteOffset, actual.length)
  const bitsB = new Uint32Array(expected.buffer, expected.byteOffset, expected.length)
  const ordered = (bits: number): number => bits & 0x80000000 ? 0x80000000 - (bits & 0x7fffffff) : 0x80000000 + bits
  let differingComponents = 0; let maxUlp = 0; let maxError = 0
  if (actual.length !== expected.length) return { differingComponents: 1, maxUlp: Infinity, maxError: Infinity }
  for (const [i, element] of expected.entries()) {
    if (actual[i] === element) continue
    differingComponents++
    maxUlp = Math.max(maxUlp, Math.abs(ordered(bitsA[i]) - ordered(bitsB[i])))
    const error = Math.abs(actual[i] - element); maxError = Math.max(maxError, Number.isFinite(error) ? error : Infinity)
  }
  return { differingComponents, maxUlp, maxError }
}
