import type { BindingDeclaration, Device } from '@luma.gl/core'
import { Computation, type Kernel } from '@luma.gl/engine'
import { fp64arithmetic, type ShaderModule } from '@luma.gl/shadertools'
import springSource from '../weighted-links/force.wgsl?raw'
import integrationSource from '../many-body/integrate.wgsl?raw'
import { replaceOnce } from '../many-body-grid/trace'
// Use luma's public expansion operations, taking the high limb after EACH operation.
// This targets the existing stepwise float32 reference, not a new float64 force law.
export const roundedArithmetic = `
fn springAdd(a: f32, b: f32) -> f32 { return sum_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
fn springSub(a: f32, b: f32) -> f32 { return sub_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
fn springMul(a: f32, b: f32) -> f32 { return mul_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
fn springDiv(a: f32, b: f32) -> f32 { return div_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
fn springRoot(a: f32) -> f32 { return sqrt_fp64(vec2f(a, 0.)).x; }
`
export function roundedSpringSource (): string {
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
  return roundedArithmetic + s
}
export function roundedIntegrationSource (): string {
  return roundedArithmetic + replaceOnce(integrationSource,
    'point.xy + velocity * params.friction',
    'vec2f(springAdd(point.x, springMul(velocity.x, params.friction)), springAdd(point.y, springMul(velocity.y, params.friction)))')
}
export async function createRoundedKernel (device: Device, source: string, bindings: BindingDeclaration[]): Promise<Pick<Kernel, 'dispatch' | 'destroy'>> {
  const computation = await Computation.createAsync(device, {
    source,
    // The pinned module's concrete uniform type is narrower than Computation's generic slot.
    modules: [fp64arithmetic as unknown as ShaderModule],
    defines: { LUMA_FP64_INTEGER_ARITHMETIC: true },
    shaderLayout: { bindings },
  })
  try { computation.updateShaderInputs() } catch (error) { computation.destroy(); throw error }
  return {
    dispatch (pass, options): void { computation.setBindings(options.bindings!); computation.dispatch(pass, options.x ?? 1, options.y, options.z) },
    destroy (): void { computation.destroy() },
  }
}
