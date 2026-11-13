import { roundedArithmetic } from '../combined-layout/spring-precision'
import { replaceOnce } from '../many-body-grid/trace'
import trig from '../combined-layout/gravity-trig.wgsl?raw'
import product from '../../gpu/rounded-product.wgsl?raw'
import square from '../many-body-grid/rounded-square.wgsl?raw'
import source from './force.wgsl?raw'
import type { CollisionArithmetic } from './data'

export function collisionForceSource (arithmetic: CollisionArithmetic): string {
  if (arithmetic === 'strict') return roundedArithmetic + trig + source
  const direction = source.slice(source.indexOf('fn collisionDirection'), source.indexOf('@compute'))
  let body = replaceOnce(source, direction, `fn collisionDirection(index: u32) -> vec2f {
  let angle = f32(index) * 2.399963229728653; return vec2f(cos(angle), sin(angle));
}
`)
  const distance = arithmetic === 'targeted' || arithmetic === 'distance'
  const accumulation = arithmetic === 'targeted' || arithmetic === 'accumulation'
  if (distance) {
    body = replaceOnce(body,
      'fn square(v: vec2f) -> f32 { return springAdd(springMul(v.x, v.x), springMul(v.y, v.y)); }',
      'fn square(v: vec2f) -> f32 { return roundedSquare(v.x) + roundedSquare(v.y); }')
  }
  if (accumulation) {
    body = replaceOnce(body, 'springMul(direction.x, weight)', 'roundedProduct(direction.x, weight)')
    body = replaceOnce(body, 'springMul(direction.y, weight)', 'roundedProduct(direction.y, weight)')
  }
  // Preserve squared-product and contribution rounding. Root/division residual
  // corrections are a tested finite-input candidate, not a universal guarantee.
  return `${accumulation ? product : ''}${distance ? square : ''}
fn springAdd(a: f32, b: f32) -> f32 { return a + b; }
fn springSub(a: f32, b: f32) -> f32 { return a - b; }
fn springMul(a: f32, b: f32) -> f32 { return a * b; }
fn springDiv(a: f32, b: f32) -> f32 { ${distance ? 'let q = a / b; return q + fma(-q, b, a) / b;' : 'return a / b;'} }
fn springRoot(a: f32) -> f32 { ${distance ? 'if (a == 0.) { return 0.; } let q = sqrt(a); return q + fma(-q, q, a) / (2. * q);' : 'return sqrt(a);'} }
${body}`
}
