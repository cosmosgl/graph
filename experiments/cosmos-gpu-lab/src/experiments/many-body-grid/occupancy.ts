import { Buffer, type Device, type ComputePass } from '@luma.gl/core'
import { Kernel } from '@luma.gl/engine'
import { bindingLayout, upload } from '../../gpu/luma'
import { resourceScope, type BufferLedger } from '../../gpu/resource-scope'
import type { Occupancy } from '../combined-layout/production-settings'
const source = `
@group(0) @binding(0) var<storage, read> aggregates: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: vec4<u32>;
@group(0) @binding(2) var<storage, read_write> blocks: array<vec4<u32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let block = gid.x; if (block >= 256u) { return; }
  let origin = vec2(block % 16u, block / 16u) * params.z;
  let end = min(origin + vec2(params.z), vec2(params.x));
  var result = vec4(0u);
  for (var y = origin.y; y < end.y; y++) { for (var x = origin.x; x < end.x; x++) {
    let n = u32(aggregates[params.y + y * params.x + x].z);
    result += vec4(n, select(0u, n, n > 8u), select(0u, n, n > 16u), select(0u, n, n > 32u));
  }}
  blocks[block] = result;
}`
export async function createOccupancy (
  device: Device, aggregates: Buffer, ledger?: BufferLedger
): Promise<{ resize(finest: number, offset: number): void; encode(pass: ComputePass): void; read(): Promise<Occupancy>; destroy(): void }> {
  const scope = resourceScope(ledger); const own = scope.own
  try {
    const params = own(upload(device, new Uint32Array(4), Buffer.UNIFORM))
    const blocks = own(device.createBuffer({ byteLength: 4096, usage: Buffer.STORAGE | Buffer.COPY_SRC }))
    const kernel = own(await Kernel.createAsync(device, {
      source,
      shaderLayout: {
        bindings: bindingLayout([
          ['aggregates', 'read-only-storage'], ['params', 'uniform'], ['blocks', 'storage'],
        ]),
      },
    }))
    return {
      resize (finest, offset): void { params.write(new Uint32Array([finest, offset, Math.ceil(finest / 16), 0])) },
      encode (pass): void { kernel.dispatch(pass, { x: 4, bindings: { aggregates, params, blocks } }) },
      async read (): Promise<Occupancy> {
        const bytes = await blocks.readAsync(); const values = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
        const sums = [0, 0, 0, 0]
        for (let i = 0; i < values.length; i++) sums[i % 4] += values[i]
        return { points: sums[0], overflow: [sums[1], sums[2], sums[3]] }
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
