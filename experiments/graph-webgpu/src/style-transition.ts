import { Buffer, type Device, type ShaderLayout } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import records from './style-records.wgsl?raw'

export type StyleKind = 'Point' | 'Link'

const layout: ShaderLayout = {
  attributes: [],
  bindings: [
    { name: 'prior', type: 'read-only-storage', group: 0, location: 0 },
    { name: 'next', type: 'read-only-storage', group: 0, location: 1 },
    { name: 'result', type: 'storage', group: 0, location: 2 },
    { name: 'state', type: 'uniform', group: 0, location: 3 },
  ],
}

function shader (kind: StyleKind): string {
  return `${records}
@group(0) @binding(0) var<storage,read> prior: array<${kind}>;
@group(0) @binding(1) var<storage,read> next: array<${kind}>;
@group(0) @binding(2) var<storage,read_write> result: array<${kind}>;
@group(0) @binding(3) var<uniform> state: vec4f;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3u) {
  let i = invocation.x + invocation.y * u32(state.w) * 64u;
  if (i >= u32(state.z)) { return; }
  if (i < u32(state.y)) { result[i] = interpolate${kind}(prior[i],next[i],state.x); }
  else { result[i] = enter${kind}(next[i],state.x); }
}`
}

/** Only an interrupted transition needs a new source. Bake exactly the styles its last frame drew. */
export class StyleTransition {
  private kernels = new Map<StyleKind, Kernel>()

  public constructor (private device: Device) {}

  public freeze (kind: StyleKind, prior: Buffer, next: Buffer, time: number, fromCount: number, toCount: number): Buffer {
    let kernel = this.kernels.get(kind)
    if (!kernel) {
      kernel = new Kernel(this.device, { id: `cosmos-freeze-${kind}`, source: shader(kind), shaderLayout: layout })
      this.kernels.set(kind, kernel)
    }
    const groups = Math.ceil(toCount / 64)
    const x = Math.min(groups, this.device.limits.maxComputeWorkgroupsPerDimension)
    const state = this.device.createBuffer({ data: new Float32Array([time, fromCount, toCount, x]), usage: Buffer.UNIFORM })
    try {
      const result = this.device.createBuffer({ byteLength: next.byteLength, usage: Buffer.STORAGE | Buffer.COPY_DST })
      try {
        if (groups) {
          const pass = this.device.beginComputePass()
          try { kernel.dispatch(pass, { x, y: Math.ceil(groups / x), bindings: { prior, next, result, state } }) } finally { pass.end() }
          this.device.submit()
        }
        return result
      } catch (error) {
        result.destroy()
        throw error
      }
    } finally { state.destroy() }
  }

  public destroy (): void {
    this.kernels.forEach(kernel => kernel.destroy())
    this.kernels.clear()
  }
}
