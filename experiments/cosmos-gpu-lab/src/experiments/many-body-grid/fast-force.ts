import { storedCentroidShader } from './centroids'
import { workgroupLocalFarShader, workgroupNativeFarShader, workgroupFactorizedFarShader } from './far-shader'
import { factorizedNearShader } from './factorized-pair'
import { refinedNearShader } from './near-shader'
import shader from './grid.wgsl?raw'

export type ForceVariant = 'corrected' | 'native-far' | 'native-near' | 'native-both' | 'factorized-far' | 'factorized-both'
export const FORCE_VARIANTS: ForceVariant[] = ['corrected', 'native-far', 'native-near', 'native-both', 'factorized-far', 'factorized-both']

// All variants visit exactly the same cells and sample slots. Only arithmetic
// changes; the strict path remains available as the control.
export function fastForceSource (variant: ForceVariant): string {
  const base = storedCentroidShader(shader, true)
  if (variant === 'factorized-far') return refinedNearShader(workgroupFactorizedFarShader(base))
  if (variant === 'factorized-both') return factorizedNearShader(workgroupFactorizedFarShader(base))
  const nativeFar = variant === 'native-far' || variant === 'native-both'
  const nativeNear = variant === 'native-near' || variant === 'native-both'
  const far = nativeFar ? workgroupNativeFarShader(base) : workgroupLocalFarShader(base)
  return nativeNear ? far : refinedNearShader(far)
}

// These diagnostic kernels omit the other part entirely. A split kernel may
// optimize differently than the full kernel; its timing is not a true profile.
export function isolatedForceSource (source: string, part: 'far' | 'near'): string {
  const start = source.indexOf('  var far = vec2(0.);')
  const near = source.indexOf('  let n = u32(params.finest);', start)
  const endMarker = '  forces[targetIndex] = vec4(far + near, 0., 0.);\n}'
  const end = source.indexOf(endMarker, near)
  if (start < 0 || near < 0 || end < 0) throw new Error('Force diagnostic shader anchors changed')
  if (part === 'near') return `${source.slice(0, start)}  var far = vec2(0.);\n${source.slice(near)}`
  return `${source.slice(0, near)}  forces[targetIndex] = vec4(far, 0., 0.);\n}${source.slice(end + endMarker.length)}`
}
