import { Buffer, type ComputePass, type RenderPass, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, createStorageRenderer, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import { createRoundedKernel, roundedArithmetic } from '../combined-layout/spring-precision'
import type { View } from '../many-body/backend'
import trig from '../combined-layout/gravity-trig.wgsl?raw'
import { maxRadius, validateCollision, validateSizes, type CollisionParameters, type CollisionArithmetic } from './data'
import source from './force.wgsl?raw'
const drawSource = `
struct View { view: vec4f, radius: f32, padding: f32, count: f32, pad: f32 }
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> sizes: array<f32>;
@group(0) @binding(2) var<uniform> params: View;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) color: vec3f }
@vertex fn vertexMain(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Vertex {
  let corners = array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(-1.,1.),vec2f(-1.,1.),vec2f(1.,-1.),vec2f(1.,1.));
  let p = positions[i]; let r = select(sizes[i] * 0.5, params.radius, params.radius > 0.) + params.padding;
  var result: Vertex; result.position = vec4f(3.,3.,0.,1.);
  if (p.w <= 0.5) { result.position = vec4f((p.xy - params.view.xy + corners[v] * r) * params.view.zw,0.,1.); }
  result.uv = corners[v]; result.color = select(vec3f(0.62,0.71,0.84),vec3f(0.91,0.72,0.51),p.z > 0.5); return result;
}
@fragment fn fragmentMain(v: Vertex) -> @location(0) vec4f {
  let d = length(v.uv); if (d > 1.) { discard; } return vec4f(v.color * select(0.4,1.,d > 0.88),1.);
}`
export async function createCollisionWebGPU (
  device: Device, initialSizes: Float32Array, forces: Buffer, settings: CollisionParameters, arithmetic: CollisionArithmetic = 'strict'
): Promise<{
  encode(pass: ComputePass, positions: Buffer, alpha: number): void; resize(sizes: Float32Array): void;
  render(positions: Buffer, view: View, pass: RenderPass): void; destroy(): void;
}> {
  validateSizes(initialSizes, initialSizes.length); validateCollision(settings)
  const scope = resourceScope(); const own = scope.own; let sizes = initialSizes
  try {
    const sizeBuffer = own(upload(device, sizes)); const params = own(upload(device, new Float32Array(8), Buffer.UNIFORM))
    const drawParams = own(upload(device, new Float32Array(8), Buffer.UNIFORM))
    const layout = bindingLayout([
      ['positions', 'read-only-storage'], ['sizes', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'],
    ])
    const direction = source.slice(source.indexOf('fn collisionDirection'), source.indexOf('@compute'))
    const nativeSource = `
fn springAdd(a: f32, b: f32) -> f32 { return a + b; }
fn springSub(a: f32, b: f32) -> f32 { return a - b; }
fn springMul(a: f32, b: f32) -> f32 { return a * b; }
fn springDiv(a: f32, b: f32) -> f32 { return a / b; }
fn springRoot(a: f32) -> f32 { return sqrt(a); }
${source.replace(direction, `fn collisionDirection(index: u32) -> vec2f {
  let angle = f32(index) * 2.399963229728653; return vec2f(cos(angle), sin(angle));
}
`)}`
    const force = own(arithmetic === 'strict'
      ? await createRoundedKernel(device, roundedArithmetic + trig + source, layout)
      : await Kernel.createAsync(device, { source: nativeSource, shaderLayout: { bindings: layout } }))
    const draw = own(createStorageRenderer(device, drawSource, 'triangle-list', bindingLayout([
      ['positions', 'read-only-storage'], ['sizes', 'read-only-storage'], ['params', 'uniform'],
    ])))
    return {
      resize (next): void {
        validateSizes(next, next.length); if (next.length > initialSizes.length) throw new Error('Collision size capacity exceeded')
        if (next.length) sizeBuffer.write(next); sizes = next
      },
      encode (pass, positions, alpha): void {
        params.write(new Float32Array([
          sizes.length, settings.strength, settings.radius, settings.padding, maxRadius(sizes, settings), alpha, settings.cooling, 0,
        ]))
        force.dispatch(pass, { x: Math.ceil(sizes.length / 64), bindings: { positions, sizes: sizeBuffer, params, forces } })
      },
      render (positions, view, pass): void {
        drawParams.write(new Float32Array([...view, settings.radius, settings.padding, sizes.length, 0]))
        if (sizes.length) {
          draw.kernel.draw(pass, {
            vertexArray: draw.vertexArray, vertexCount: 6, instanceCount: sizes.length, bindings: { positions, sizes: sizeBuffer, params: drawParams },
          })
        }
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
