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
