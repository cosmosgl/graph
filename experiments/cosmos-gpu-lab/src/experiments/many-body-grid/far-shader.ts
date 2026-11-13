import roundedSquare from './rounded-square.wgsl?raw'
import farArithmetic from './far-arithmetic.wgsl?raw'
import { replaceOnce } from './trace'

// A storage boundary separates per-cell force evaluation from accumulation.
export function materializedFarShader (shader: string): string {
  shader += roundedSquare + farArithmetic
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
    'velocity += farPairVelocity(point.xy - centroids[cellIndex].xy, vec2(0.), a.z)') + roundedSquare + farArithmetic
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
