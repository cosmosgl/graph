import roundedSquare from './rounded-square.wgsl?raw'
import farArithmetic from './far-arithmetic.wgsl?raw'
import quotientRoot from './rounded-quotient-root.wgsl?raw'
import { factorizedPairFunctions } from './factorized-pair'
import { replaceOnce } from './trace'

// A storage boundary separates per-cell force evaluation from accumulation.
export function materializedFarShader (shader: string): string {
  shader += roundedSquare + quotientRoot + farArithmetic
  const call = 'if (a.z > 0.) { velocity += pairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z); }'
  const index = '(targetIndex * u32(params.levelCount) + level) * 100u + u32(j * width + i)'
  const start = shader.indexOf('@compute @workgroup_size(64)\nfn forceMain')
  const end = shader.indexOf('  let n = u32(params.finest);', start)
  const producer = `${shader.slice(start, end).replace('fn forceMain(', 'fn farMain(')
    .replace('    far += velocity;', '')
    .replace('var far = vec2(0.);', '')
    .replace('var velocity = vec2(0.);', '')
    .replace('forces[targetIndex] = vec4(0.); return;', 'return;')
    .replace(call, `if (a.z > 0.) { farContributions[${index}] = farPairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z); }`)}}\n`
  return `${replaceOnce(shader, call, `if (a.z > 0.) { velocity += farContributions[${index}]; }`)
    .replace('let a = aggregates[cellIndex];', 'let a = centroids[cellIndex];')
    .replace('let mass = aggregates[', 'let mass = centroids[') + producer
  }@group(0) @binding(12) var<storage, read_write> farContributions: array<vec2<f32>>;\n`
}

export function refinedFarShader (shader: string): string {
  return replaceOnce(shader, 'velocity += pairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z)',
    'velocity += farPairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z)') + roundedSquare + quotientRoot + farArithmetic
}

// Diagnostic: materialize one contribution per lane in workgroup memory.
// All 64 lanes participate in each barrier, including absent and tail lanes.
// The fixed 100-slot loop keeps barriers out of non-uniform control flow.
export function workgroupFarShader (shader: string): string {
  const source = refinedFarShader(shader)
  const start = source.indexOf('@compute @workgroup_size(64)\nfn forceMain')
  const end = source.indexOf('  let n = u32(params.finest);', start)
  if (start < 0 || end < start) throw new Error('Workgroup force shader anchors changed')
  const original = source.slice(start, end)
  return replaceOnce(source, original, `
var<workgroup> farScratch: array<vec2<f32>, 64>;
@compute @workgroup_size(64)
fn forceMain(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) local: u32) {
  let targetIndex = gid.x;
  var point = vec4<f32>(0.); var validTarget = false;
  if (targetIndex < u32(params.count)) { point = positions[targetIndex]; validTarget = point.w <= 0.5; }
  var far = vec2<f32>(0.);
  for (var level = 0u; level < u32(params.levelCount); level++) {
    let n = levels[level].x; let cell = vec2<i32>(gridCell(point.xy, n));
    let shell = select(1, 2, params.quality > 0.5 && level + 1u < u32(params.levelCount));
    let parentShell = select(1, 2, params.quality > 0.5);
    var base = vec2<i32>(0); var width = i32(n);
    if (level > 0u) { base = (cell / 2) * 2 - vec2<i32>(2 * parentShell); width = 2 * (2 * parentShell + 1); }
    var velocity = vec2<f32>(0.);
    for (var slot = 0u; slot < 100u; slot++) {
      let i = i32(slot) % width; let j = i32(slot) / width;
      let candidate = base + vec2<i32>(i, j); let diff = abs(candidate - cell);
      var contribution = vec2<f32>(0.); var occupied = false;
      if (validTarget && slot < u32(width * width) && all(candidate >= vec2<i32>(0)) &&
          all(candidate < vec2<i32>(i32(n))) && max(diff.x, diff.y) > shell) {
        let cellIndex = levels[level].y + u32(candidate.y) * n + u32(candidate.x);
        let a = centroids[cellIndex];
        if (a.z > 0.) { contribution = farPairVelocity(point.xy - a.xy, vec2<f32>(0.), a.z); occupied = true; }
      }
      farScratch[local] = contribution;
      workgroupBarrier();
      if (occupied) { velocity += farScratch[local]; }
    }
    far += velocity;
  }
  if (!validTarget) { if (targetIndex < u32(params.count)) { forces[targetIndex] = vec4<f32>(0.); } return; }
`)
}

// Each invocation owns its local-index slot, so no other lane observes its
// writes and no workgroup barrier is needed for this version.
export function workgroupLocalFarShader (shader: string): string {
  let source = refinedFarShader(shader)
  source = replaceOnce(source,
    '@compute @workgroup_size(64)\nfn forceMain(@builtin(global_invocation_id) gid: vec3<u32>)',
    `var<workgroup> farScratch: array<vec2<f32>, 64>;
@compute @workgroup_size(64)
fn forceMain(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_index) local: u32)`)
  return replaceOnce(source,
    'velocity += farPairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z)',
    'farScratch[local] = farPairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z); velocity += farScratch[local]')
}

// Performance candidate: retain the same cells and per-lane scratch, but use
// native float arithmetic for distant contributions. Strict parity is tested
// separately; this does not change the default force.
export function workgroupNativeFarShader (shader: string): string {
  return replaceOnce(workgroupLocalFarShader(shader),
    'farScratch[local] = farPairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z)',
    'farScratch[local] = pairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z)')
}

export function workgroupFactorizedFarShader (shader: string): string {
  return factorizedPairFunctions(replaceOnce(workgroupNativeFarShader(shader),
    'farScratch[local] = pairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z)',
    'farScratch[local] = factorizedPairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z)'))
}

// Reuse one level's contribution slots, retaining only each cumulative far sum.
export function streamedFarShader (shader: string): string {
  const full = materializedFarShader(shader)
    .replaceAll('(targetIndex * u32(params.levelCount) + level) * 100u', 'targetIndex * 100u')
  const start = full.indexOf('@compute @workgroup_size(64)\nfn forceMain')
  const near = full.indexOf('  let n = u32(params.finest);', start)
  const farStart = full.indexOf('  var far = vec2(0.);', start)
  const producerStart = full.indexOf('fn farMain(')
  if (start < 0 || near < 0 || farStart < 0 || producerStart < 0) throw new Error('Streamed force shader anchors changed')
  const loop = 'for (var level = 0u; level < u32(params.levelCount); level++)'
  const accumulator = `${full.slice(start, near).replace('fn forceMain(', 'fn accumulateMain(')
    .replace(loop, 'for (var level = farLevel.x; level <= farLevel.x; level++)')
    .replace('forces[targetIndex] = vec4(0.); return;', 'farSums[farLevel.x * u32(params.count) + targetIndex] = vec2(0.); return;')
    .replace('var far = vec2(0.);', 'var far = vec2(0.); if (farLevel.x > 0u) { far = farSums[(farLevel.x - 1u) * u32(params.count) + targetIndex]; }')
    .replace('far += velocity;', 'far += velocity; farSums[level * u32(params.count) + targetIndex] = far;')}}\n`
  const tail = full.slice(near, producerStart) + full.slice(producerStart).replace(loop,
    'for (var level = farLevel.x; level <= farLevel.x; level++)')
  return `${full.slice(0, farStart)}  var far = vec2(0.);
  for (var level = 0u; level < u32(params.levelCount); level++) {
    far = farSums[level * u32(params.count) + targetIndex];
  }
${tail}
${accumulator}
@group(0) @binding(13) var<uniform> farLevel: vec4<u32>;
@group(0) @binding(14) var<storage, read_write> farSums: array<vec2<f32>>;
`
}

// Reuse the same per-level contribution slots for bounded groups of targets.
// The target index remains global for positions and cumulative sums, while
// scratch addresses are local to the currently dispatched group of targets.
export function chunkedFarShader (shader: string): string {
  let source = streamedFarShader(shader)
  const patch = (startMarker: string, endMarker: string): void => {
    const start = source.indexOf(startMarker); const end = source.indexOf(endMarker, start)
    if (start < 0 || end < start) throw new Error('Chunked force shader anchors changed')
    const original = source.slice(start, end)
    let changed = replaceOnce(original,
      'let targetIndex = gid.x; if (targetIndex >= u32(params.count)) { return; }',
      'let targetIndex = gid.x + farChunk.x; if (gid.x >= farChunk.y || targetIndex >= u32(params.count)) { return; }')
    changed = replaceOnce(changed, 'targetIndex * 100u + u32(j * width + i)', 'gid.x * 100u + u32(j * width + i)')
    source = replaceOnce(source, original, changed)
  }
  patch('fn farMain(', '@group(0) @binding(12)')
  patch('fn accumulateMain(', '@group(0) @binding(13)')
  return `${source}\n@group(0) @binding(16) var<uniform> farChunk: vec4<u32>;\n`
}
