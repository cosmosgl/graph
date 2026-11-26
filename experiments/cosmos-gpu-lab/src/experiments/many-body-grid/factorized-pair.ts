import source from './factorized-pair.wgsl?raw'
import { replaceOnce } from './trace'

export function factorizedPairFunctions (shader: string): string {
  return shader.includes('fn factorizedPairVelocity(') ? shader : shader + source
}
export function factorizedNearShader (shader: string): string {
  return factorizedPairFunctions(replaceOnce(shader,
    'sum += pairVelocity(point.xy - positions[source].xy, randomDir, 1.);',
    'sum += factorizedPairVelocity(point.xy - positions[source].xy, randomDir, 1.);'))
}
