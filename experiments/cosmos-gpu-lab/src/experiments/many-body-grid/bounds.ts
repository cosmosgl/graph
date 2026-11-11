import { Buffer, type Device, type ComputePass } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, upload } from '../../gpu/luma'
import { createRoundedKernel } from '../../gpu/rounded-kernel'
import { resourceScope, type BufferLedger } from '../../gpu/resource-scope'
import { frameSamples } from './data'
import source from './bounds.wgsl?raw'

const finishSource = `
@group(0) @binding(0) var<storage, read> extrema: array<vec4f>;
@group(0) @binding(1) var<uniform> params: vec4f;
@group(0) @binding(2) var<storage, read_write> box: vec4f;
fn add(a: f32, b: f32) -> f32 { return sum_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
fn sub(a: f32, b: f32) -> f32 { return sub_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
fn mul(a: f32, b: f32) -> f32 { return mul_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
fn div(a: f32, b: f32) -> f32 { return div_fp64(vec2f(a, 0.), vec2f(b, 0.)).x; }
@compute @workgroup_size(1) fn main() {
  var b = extrema[0];
  if (b.x > b.z) { b = vec4f(0.); }
  let extent = max(max(sub(b.z, b.x), sub(b.w, b.y)), params.x * 0.25);
  let cell = div(extent, 7.);
  let x = sub(mul(add(b.x, b.z), 0.5), mul(extent, 0.5));
  let y = sub(mul(add(b.y, b.w), 0.5), mul(extent, 0.5));
  let span = add(extent, cell);
  box = vec4f(sub(x, mul(params.y, cell)), sub(y, mul(params.z, cell)), span, div(1., span));
}`

// One parallel min/max pass per level, then ONE invocation for frame arithmetic.
// Fixed per-level uniforms avoid queue writes changing earlier encoded dispatches.
export async function createGpuBounds (device: Device, count: number, finest: number, box: Buffer, ledger?: BufferLedger, capacity = count): Promise<{
  resize(count: number, finest: number): void; prepare(tick: number): void; encode(pass: ComputePass, positions: Buffer): void; destroy(): void;
}> {
  const scope = resourceScope(ledger); const own = scope.own
  try {
    const reduce = own(await Kernel.createAsync(device, {
      id: 'cosmos-bounds-reduce',
      source,
      shaderLayout: { bindings: bindingLayout([['values', 'read-only-storage'], ['partials', 'storage'], ['params', 'uniform']]) },
    }))
    const levels: Array<{ output: Buffer; params: Buffer; groups: number }> = []
    let n = capacity
    do {
      const groups = Math.max(1, Math.ceil(n / 256))
      levels.push({
        groups,
        output: own(device.createBuffer({ byteLength: groups * 16, usage: Buffer.STORAGE })),
        params: own(upload(device, new Uint32Array([n, levels.length ? 1 : 0, 0, 0]), Buffer.UNIFORM)),
      })
      n = groups
    } while (n > 1)
    let activeLevels = 0
    const resize = (next: number, grid: number): void => {
      if (!Number.isInteger(next) || next < 0 || next > capacity) throw new Error('Bounds capacity exceeded')
      finest = grid; let n = next; activeLevels = 0
      do {
        const level = levels[activeLevels]; level.groups = Math.max(1, Math.ceil(n / 256))
        level.params.write(new Uint32Array([n, activeLevels ? 1 : 0, 0, 0]))
        n = level.groups; activeLevels++
      } while (n > 1)
    }
    resize(count, finest)
    const params = own(upload(device, new Float32Array(4), Buffer.UNIFORM))
    const finish = own(await createRoundedKernel(device, finishSource,
      bindingLayout([['extrema', 'read-only-storage'], ['params', 'uniform'], ['box', 'storage']])))
    return {
      resize,
      prepare (tick): void { const { jitter } = frameSamples(tick); params.write(new Float32Array([finest, ...jitter, 0])) },
      encode (pass, positions): void {
        let values = positions
        for (const level of levels.slice(0, activeLevels)) {
          reduce.dispatch(pass, { x: level.groups, bindings: { values, partials: level.output, params: level.params } })
          values = level.output
        }
        finish.dispatch(pass, { x: 1, bindings: { extrema: values, params, box } })
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
