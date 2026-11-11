import { Buffer } from '@luma.gl/core'
import { bindingLayout, createDevice, readFloats, upload } from '../../gpu/luma'
import { replaceOnce } from '../many-body-grid/trace'
import { createRoundedKernel } from './spring-precision'
import { polarGravitySource, refinedGravitySource } from './gravity-source'
import { GRAVITY } from './data'
export const GRAVITY_FIELDS = ['distance', 'angle', 'magnitude', 'cosine', 'sine', 'force x', 'force y', 'padding'] as const
export type GravityTrace = {
  forcesMatchUninstrumented: boolean;
  fields: Array<{ field: string; differing: number; maxError: number; examples: Array<{ point: number; gpu: number; cpu: number }> }>;
}
export async function traceGravity (points: Float32Array, alpha: number, uninstrumented: Float32Array, refined = false): Promise<GravityTrace> {
  let source = refined ? refinedGravitySource : polarGravitySource
  if (!refined) {
    source = replaceOnce(source, '    force = vec2f(', '    let cosine = cos(angle); let sine = sin(angle);\n    force = vec2f(')
    source = replaceOnce(source, 'springMul(magnitude, cos(angle)), springMul(magnitude, sin(angle))',
      'springMul(magnitude, cosine), springMul(magnitude, sine)')
  }
  source = replaceOnce(source, '    force = vec2f(springMul(magnitude, cosine), springMul(magnitude, sine));',
    `    force = vec2f(springMul(magnitude, cosine), springMul(magnitude, sine));
    trace[id.x * 2u] = vec4f(distance, angle, magnitude, cosine);
    trace[id.x * 2u + 1u] = vec4f(sine, force, 0.);`)
  source += '\n@group(0) @binding(3) var<storage, read_write> trace: array<vec4f>;'
  const device = await createDevice('webgpu', undefined, false)
  const owned: Array<{ destroy(): void }> = []; const own = <T extends { destroy(): void }>(r: T): T => { owned.push(r); return r }
  try {
    const positions = own(upload(device, points))
    const params = own(upload(device, new Float32Array([points.length / 4, alpha, GRAVITY, 0]), Buffer.UNIFORM))
    const forces = own(upload(device, new Float32Array(points.length).fill(NaN)))
    const trace = own(upload(device, new Float32Array(points.length * 2).fill(NaN)))
    const kernel = own(await createRoundedKernel(device, source, bindingLayout([
      ['positions', 'read-only-storage'], ['params', 'uniform'], ['forces', 'storage'], ['trace', 'storage'],
    ])))
    const pass = device.beginComputePass()
    try { kernel.dispatch(pass, { x: Math.ceil(points.length / 256), bindings: { positions, params, forces, trace } }) } finally { pass.end() }
    device.submit()
    const actual = await readFloats(trace); const actualForces = await readFloats(forces)
    if (!actual.every(Number.isFinite)) throw new Error('Gravity trace requires nonzero finite input points and written trace values')
    const bits = new Uint32Array(actualForces.buffer); const expectedBits = new Uint32Array(uninstrumented.buffer,
      uninstrumented.byteOffset, uninstrumented.length)
    const fields: GravityTrace['fields'] = GRAVITY_FIELDS.slice(0, 7).map(field => ({ field, differing: 0, maxError: 0, examples: [] }))
    const f = Math.fround
    for (let i = 0; i < points.length / 4; i++) {
      const x = f(-points[i * 4]); const y = f(-points[i * 4 + 1])
      const distance = f(Math.sqrt(f(f(x * x) + f(y * y)))); const angle = f(Math.atan2(y, x))
      const magnitude = f(f(f(f(alpha) * f(GRAVITY)) * distance) * f(0.1))
      const cosine = f(Math.cos(angle)); const sine = f(Math.sin(angle))
      const expected = [distance, angle, magnitude, cosine, sine, f(magnitude * cosine), f(magnitude * sine)]
      for (const [j, cpu] of expected.entries()) {
        const gpu = actual[i * 8 + j]
        if (gpu !== cpu) {
          fields[j].differing++; fields[j].maxError = Math.max(fields[j].maxError, Math.abs(gpu - cpu))
          if (fields[j].examples.length < 4) fields[j].examples.push({ point: i, gpu, cpu })
        }
      }
    }
    return { forcesMatchUninstrumented: bits.every((v, i) => v === expectedBits[i]), fields }
  } finally { try { owned.reverse().forEach(r => r.destroy()) } finally { device.destroy() } }
}
