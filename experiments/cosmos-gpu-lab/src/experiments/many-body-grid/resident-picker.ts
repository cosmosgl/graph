import { Buffer, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout } from '../../gpu/luma'
import { resourceScope } from '../../gpu/resource-scope'

const workgroupSize = 64
const wordBytes = Uint32Array.BYTES_PER_ELEMENT
const source = `
struct PickParams {
  viewport: vec4f,
  pixel: vec2f,
}
@group(0) @binding(0) var<storage, read> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> view: vec4f;
@group(0) @binding(2) var<uniform> params: PickParams;
@group(0) @binding(3) var<storage, read_write> selected: atomic<u32>;

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x;
  if (index >= u32(params.viewport.w)) { return; }
  let point = positions[index];
  if (point.w > 0.5) { return; }

  let center = view.xy + vec2f(view.z * 0.5);
  let scale = params.viewport.y / (view.z * 1.1);
  let screen = (point.xy - center) * vec2f(scale, -scale) + params.viewport.xy * 0.5;
  let offset = (params.pixel - screen) / (2.5 * params.viewport.z);
  let hit = select(dot(offset, offset) <= 1., all(abs(offset) <= vec2f(1.)), point.z > 0.5);
  if (hit) { atomicMax(&selected, index + 1u); }
}
`

export type ResidentPicker = {
  readonly bytes: number;
  /**
   * Samples the pixel under the pointer in framebuffer coordinates. The largest
   * visible point ID wins, as points are drawn in index order.
   * The caller must await completion before starting another pick.
   */
  pick(positions: Buffer, view: Buffer, x: number, y: number, width: number, height: number, pixelRatio: number): Promise<number | null>;
  destroy(): void;
}

export async function createResidentPicker (device: Device, count: number): Promise<ResidentPicker> {
  const groups = Math.ceil(count / workgroupSize)
  if (!Number.isInteger(count) || count < 1 || count > 2 ** 24 || groups > device.limits.maxComputeWorkgroupsPerDimension) {
    throw new Error('Invalid resident picking point count')
  }
  const scope = resourceScope()
  try {
    const paramsData = new Float32Array(8)
    const params = scope.own(device.createBuffer({ byteLength: paramsData.byteLength, usage: Buffer.UNIFORM | Buffer.COPY_DST }))
    const selected = scope.own(device.createBuffer({ byteLength: wordBytes, usage: Buffer.STORAGE | Buffer.COPY_DST | Buffer.COPY_SRC }))
    const readback = scope.own(device.createBuffer({ byteLength: wordBytes, usage: Buffer.MAP_READ | Buffer.COPY_DST }))
    const clear = new Uint32Array(1)
    const kernel = scope.own(await Kernel.createAsync(device, {
      source,
      shaderLayout: {
        bindings: bindingLayout([['positions', 'read-only-storage'], ['view', 'read-only-storage'], ['params', 'uniform'], ['selected', 'storage']]),
      },
    }))
    let busy = false
    let destroyed = false
    return {
      bytes: params.byteLength + selected.byteLength + readback.byteLength,
      async pick (positions, view, x, y, width, height, pixelRatio): Promise<number | null> {
        if (destroyed || device.isLost) throw new Error('Resident picker unavailable')
        if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 ||
          !Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new Error('Invalid resident picking viewport')
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height) return null
        if (busy) throw new Error('Resident pick already in flight')
        if (positions.device !== device || view.device !== device || positions.byteLength < count * 16 || view.byteLength !== 16) {
          throw new Error('Invalid resident picking buffers')
        }

        busy = true
        try {
          paramsData.set([width, height, pixelRatio, count, Math.floor(x) + 0.5, Math.floor(y) + 0.5])
          params.write(paramsData)
          selected.write(clear)
          const pass = device.beginComputePass()
          try { kernel.dispatch(pass, { x: groups, bindings: { positions, view, params, selected } }) } finally { pass.end() }
          device.commandEncoder.copyBufferToBuffer({ sourceBuffer: selected, destinationBuffer: readback, size: wordBytes })
          device.submit()
          const bytes = await readback.readAsync()
          const id = new Uint32Array(bytes.buffer, bytes.byteOffset, 1)[0]
          return id ? id - 1 : null
        } finally { busy = false }
      },
      destroy (): void {
        if (destroyed) return
        destroyed = true
        scope.destroy()
      },
    }
  } catch (error) { scope.destroy(); throw error }
}
