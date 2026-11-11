import springSource from '../weighted-links/force.wgsl?raw'
import integrationSource from '../many-body/integrate.wgsl?raw'
import roundedSquare from '../many-body-grid/rounded-square.wgsl?raw'
import { replaceOnce } from '../many-body-grid/trace'
import roundedProduct from '../../gpu/rounded-product.wgsl?raw'
export { createRoundedKernel } from '../../gpu/rounded-kernel'
// Use luma's public expansion operations, taking the high limb after EACH operation.
// This targets the existing stepwise float32 reference, not a new float64 force law.
export const roundedArithmetic = `
fn springAdd(a: f32, b: f32) -> f32 { return sum_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
fn springSub(a: f32, b: f32) -> f32 { return sub_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
fn springMul(a: f32, b: f32) -> f32 { return mul_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
fn springDiv(a: f32, b: f32) -> f32 { return div_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
fn springRoot(a: f32) -> f32 { return sqrt_fp64(vec2f(a, 0.)).x; }
`
// Residual correction is cheaper but not a portable correctly-rounded guarantee.
// Keep integer-controlled addition/multiplication and the full candidate as a control.
export const refinedArithmetic = roundedArithmetic
  .replace('return div_fp64(vec2f(a, 0.), vec2f(b, 0.)).x;', 'let q = a / b; return q + fma(-q, b, a) / b;')
  .replace('return sqrt_fp64(vec2f(a, 0.)).x;', 'if (a == 0.) { return 0.; } let q = sqrt(a); return q + fma(-q, q, a) / (2. * q);')
export function roundedSpringSource (refined = false): string {
  let s = replaceOnce(springSource,
    '(edge.random * (params.high - params.low) + params.low) * params.distance',
    'springMul(springAdd(springMul(edge.random, springSub(params.high, params.low)), params.low), params.distance)')
  s = replaceOnce(s, 'let delta = other.xy - (point.xy + velocity);',
    'let delta = vec2f(springSub(other.x, springAdd(point.x, velocity.x)), springSub(other.y, springAdd(point.y, velocity.y)));')
  s = replaceOnce(s, 'sqrt(delta.x * delta.x + delta.y * delta.y), rest * 0.99',
    'springRoot(springAdd(springMul(delta.x, delta.x), springMul(delta.y, delta.y))), springMul(rest, 0.99)')
  s = replaceOnce(s, '(length - rest) / length', 'springDiv(springSub(length, rest), length)')
  s = replaceOnce(s, 'length *= params.spring * params.alpha;', 'length = springMul(length, springMul(params.spring, params.alpha));')
  s = replaceOnce(s, 'length *= edge.strength;', 'length = springMul(length, edge.strength);')
  s = replaceOnce(s, 'length *= edge.bias;', 'length = springMul(length, edge.bias);')
  s = replaceOnce(s, 'velocity += delta * length;',
    'velocity = vec2f(springAdd(velocity.x, springMul(delta.x, length)), springAdd(velocity.y, springMul(delta.y, length)));')
  return (refined ? refinedArithmetic : roundedArithmetic) + s
}
export function roundedIntegrationSource (): string {
  return roundedArithmetic + replaceOnce(integrationSource,
    'point.xy + velocity * params.friction',
    'vec2f(springAdd(point.x, springMul(velocity.x, params.friction)), springAdd(point.y, springMul(velocity.y, params.friction)))')
}
// Targeted finite-normal helpers avoid full fp64 expansion arithmetic in the edge loop.
export type ProductCorrection = 'none' | 'scale' | 'accumulation' | 'products'
export function distanceSpringSource (correction: ProductCorrection = 'none'): string {
  let s = replaceOnce(springSource, 'sqrt(delta.x * delta.x + delta.y * delta.y)',
    'distanceRoot(roundedSquare(delta.x) + roundedSquare(delta.y))')
  s = replaceOnce(s, '(length - rest) / length', 'distanceDivide(length - rest, length)')
  if (correction === 'scale' || correction === 'products') {
    s = replaceOnce(s, 'length *= params.spring * params.alpha;', 'length = roundedProduct(length, roundedProduct(params.spring, params.alpha));')
    s = replaceOnce(s, 'length *= edge.strength;', 'length = roundedProduct(length, edge.strength);')
    s = replaceOnce(s, 'length *= edge.bias;', 'length = roundedProduct(length, edge.bias);')
  }
  if (correction === 'accumulation' || correction === 'products') {
    s = replaceOnce(s, 'velocity += delta * length;', 'velocity += vec2(roundedProduct(delta.x, length), roundedProduct(delta.y, length));')
  }
  return `${correction === 'none' ? '' : roundedProduct}${roundedSquare}
fn distanceDivide(a: f32, b: f32) -> f32 { let q = a / b; return q + fma(-q, b, a) / b; }
fn distanceRoot(a: f32) -> f32 {
  if (a == 0.) { return 0.; }
  let q = sqrt(a); return q + fma(-q, q, a) / (2. * q);
}
${s}`
}
