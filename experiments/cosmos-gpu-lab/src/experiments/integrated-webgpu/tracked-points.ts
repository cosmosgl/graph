import { Buffer, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout, readFloats, upload } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'
import type { PositionSource } from '../many-body/backend'

const source = `
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> indices: array<u32>;
@group(0) @binding(2) var<storage, read_write> output: array<vec2u>;
@group(0) @binding(3) var<uniform> params: vec4u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3u) {
  let slot = invocation.x;
  if (slot >= params.x) { return; }
  let missing = vec2u(0x7fc00000u);
  let index = indices[slot];
  if (index >= params.y) {
    output[slot] = missing;
    return;
  }
  let point = positions[index];
  output[slot] = select(bitcast<vec2u>(point.xy), missing, point.w > 0.5);
}
`

type TrackedPositions = { array: Float32Array; map: Map<number, [number, number]> }

export async function createTrackedPoints (device: Device): Promise<{
  read(positions: PositionSource, indices: readonly number[]): Promise<TrackedPositions>;
  destroy(): void;
}> {
  const kernel = await Kernel.createAsync(device, {
    source,
    shaderLayout: {
      bindings: bindingLayout([
        ['positions', 'read-only-storage'], ['indices', 'read-only-storage'], ['output', 'storage'], ['params', 'uniform'],
      ]),
    },
  })
  return {
    async read (positions, indices): Promise<TrackedPositions> {
      if (positions.device !== device) throw new Error('Tracked positions belong to another device')
      const map: TrackedPositions['map'] = new Map()
      if (!indices.length) return { array: new Float32Array(), map }

      // The request keeps its own indices and output so overlapping reads can finish independently.
      const encoded = Uint32Array.from(indices, index => (
        Number.isInteger(index) && index >= 0 && index < positions.count ? index : 0xffffffff
      ))
      const scope = resourceScope()
      try {
        const ids = scope.own(upload(device, encoded))
        const params = scope.own(upload(device, new Uint32Array([encoded.length, positions.count, 0, 0]), Buffer.UNIFORM))
        const bytes = encoded.length * 8
        const output = scope.own(device.createBuffer({ byteLength: Math.max(16, bytes), usage: Buffer.STORAGE | Buffer.COPY_SRC }))
        const pass = device.beginComputePass()
        try {
          kernel.dispatch(pass, { x: Math.ceil(encoded.length / 64), bindings: { positions: positions.buffer, indices: ids, output, params } })
        } finally { pass.end() }
        device.submit()

        const array = await readFloats(output, bytes)
        encoded.forEach((index, slot) => {
          const x = array[slot * 2]; const y = array[slot * 2 + 1]
          if (Number.isFinite(x) && Number.isFinite(y)) map.set(index, [x, y])
        })
        return { array, map }
      } finally { scope.destroy() }
    },
    destroy: (): void => { kernel.destroy() },
  }
}
