import { Buffer, type Device, type ShaderLayout } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import records from './style-records.wgsl?raw'
import { interruptedPointTable, pointStride, readPointStyle } from './modules/Points/style-table'
import { workgroupGrid } from './modules/Shared/compute'
import freeze from './modules/Points/freeze-styles.wgsl?raw'

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
struct State { time: f32, fromCount: f32, toCount: f32, groupsX: f32, animateMetric: f32 }
@group(0) @binding(3) var<uniform> state: State;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3u) {
  let i = invocation.x + invocation.y * u32(state.groupsX) * 64u;
  if (i >= u32(state.toCount)) { return; }
  if (i < u32(state.fromCount)) { result[i] = interpolate${kind}(prior[i],next[i],state.time,state.animateMetric); }
  // A new index starts with its target style at both ends of the transition.
  else { result[i] = next[i]; }
}`
}

/** Only an interrupted transition needs a new source. Bake exactly the styles its last frame drew. */
export class StyleTransition {
  private kernels = new Map<StyleKind, Kernel>()

  private compactPoints?: Kernel

  public constructor (private device: Device) {}

  public freezePoints (
    prior: Buffer, next: Buffer, time: number, fromCount: number, toCount: number, animateMetric: boolean, tables: WeakMap<Buffer, Uint32Array>
  ): Buffer {
    const previousIds = tables.get(prior); const nextIds = tables.get(next)
    if (!previousIds && !nextIds) return this.freeze('Point', prior, next, time, fromCount, toCount, animateMetric)
    const { ids, mixShared } = interruptedPointTable(previousIds, nextIds, fromCount, toCount, this.device.limits.maxStorageBufferBindingSize)
    const physicalCount = ids ? ids.length + 1 : toCount
    this.compactPoints ??= new Kernel(this.device, {
      id: 'cosmos-freeze-shared-point-styles',
      source: records + freeze + readPointStyle('readPrior', 'prior') + readPointStyle('readTarget', 'next'),
      shaderLayout: { ...layout, bindings: [...layout.bindings!, { name: 'ids', type: 'read-only-storage', group: 0, location: 4 }] },
    })
    const values = new Float32Array(8)
    values.set([time, +animateMetric])
    const pointCounts = [previousIds ? previousIds.length + 1 : 0, nextIds ? nextIds.length + 1 : 0]
    new Uint32Array(values.buffer).set([fromCount, physicalCount, ...pointCounts, +!!ids, +mixShared], 2)
    const state = this.device.createBuffer({ data: values, usage: Buffer.UNIFORM })
    let keys: Buffer | undefined
    let result: Buffer | undefined
    try {
      keys = this.device.createBuffer({ data: ids?.length ? ids : Uint32Array.of(0), usage: Buffer.STORAGE })
      result = this.device.createBuffer({ byteLength: physicalCount * pointStride * 4, usage: Buffer.STORAGE | Buffer.COPY_DST })
      const groups = workgroupGrid(Math.ceil(physicalCount / 64), this.device.limits.maxComputeWorkgroupsPerDimension)
      const pass = this.device.beginComputePass()
      try { this.compactPoints.dispatch(pass, { ...groups, bindings: { prior, next, result, state, ids: keys } }) } finally { pass.end() }
      this.device.submit()
      if (ids) tables.set(result, ids)
      return result
    } catch (e) { result?.destroy(); throw e } finally { state.destroy(); keys?.destroy() }
  }

  public freeze (kind: StyleKind, prior: Buffer, next: Buffer, time: number, fromCount: number, toCount: number, animateMetric: boolean): Buffer {
    let kernel = this.kernels.get(kind)
    if (!kernel) {
      kernel = new Kernel(this.device, { id: `cosmos-freeze-${kind}`, source: shader(kind), shaderLayout: layout })
      this.kernels.set(kind, kernel)
    }
    const groups = Math.ceil(toCount / 64)
    const x = Math.min(groups, this.device.limits.maxComputeWorkgroupsPerDimension)
    const state = this.device.createBuffer({ data: new Float32Array([time, fromCount, toCount, x, +animateMetric, 0, 0, 0]), usage: Buffer.UNIFORM })
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
    this.compactPoints?.destroy()
    this.kernels.forEach(kernel => kernel.destroy())
    this.kernels.clear()
  }
}
