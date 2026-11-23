import { Buffer, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import type { PointPositionBuffer } from './simulation'

const source = `
@group(0) @binding(0) var<storage, read> previous: array<vec4f>;
@group(0) @binding(1) var<storage, read> destinations: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> live: array<vec4f>;
@group(0) @binding(3) var<uniform> progress: f32;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&destinations)) { return; }
  let to = destinations[i];
  var xy = to.xy;
  if (i < arrayLength(&previous) && progress < 1.0) {
    let start = previous[i];
    if (start.w == 0.0 && to.w == 0.0) { xy = mix(start.xy, to.xy, progress); }
  }
  live[i] = vec4f(xy, live[i].z, to.w);
}`

/** Queue the copy before applyData can replace or overwrite the current allocation. */
export function copyPositions ({ device, buffer, count }: PointPositionBuffer): Buffer {
  const size = count * 16
  const copy = device.createBuffer({ byteLength: size, usage: Buffer.STORAGE | Buffer.COPY_DST })
  try {
    const encoder = device.createCommandEncoder()
    try {
      encoder.copyBufferToBuffer({ sourceBuffer: buffer, destinationBuffer: copy, size })
      device.submit(encoder.finish())
    } finally { encoder.destroy() }
    return copy
  } catch (error) {
    copy.destroy()
    throw error
  }
}

export class PositionTransition {
  private readonly kernel: Kernel
  private readonly uniform: Buffer
  private previous?: Buffer
  private target?: Buffer

  public constructor (private readonly device: Device) {
    this.kernel = new Kernel(device, {
      source,
      shaderLayout: {
        bindings: [
          { name: 'previous', type: 'read-only-storage', location: 0, group: 0 },
          { name: 'destinations', type: 'read-only-storage', location: 1, group: 0 },
          { name: 'live', type: 'storage', location: 2, group: 0 },
          { name: 'progress', type: 'uniform', location: 3, group: 0 },
        ],
      },
    })
    this.uniform = device.createBuffer({ byteLength: 16, usage: Buffer.UNIFORM | Buffer.COPY_DST })
  }

  public begin (previous: Buffer, live: PointPositionBuffer): void {
    this.clear()
    this.previous = previous
    this.target = copyPositions(live)
  }

  /** Snap the edited slot while the other points continue toward their destinations. */
  public edit (index: number, record: Float32Array): void {
    const offset = index * 16
    for (const buffer of [this.previous, this.target]) {
      if (buffer && offset + 16 <= buffer.byteLength) buffer.write(record, offset)
    }
  }

  public write (live: PointPositionBuffer, progress: number): boolean {
    if (!this.previous || !this.target) return false
    this.uniform.write(new Float32Array([progress]))
    const encoder = this.device.createCommandEncoder()
    try {
      const pass = encoder.beginComputePass({})
      try {
        this.kernel.dispatch(pass, {
          x: Math.ceil(live.count / 64),
          bindings: {
            previous: this.previous, destinations: this.target, live: live.buffer, progress: this.uniform,
          },
        })
      } finally { pass.end() }
      this.device.submit(encoder.finish())
    } finally { encoder.destroy() }
    if (progress >= 1) this.clear()
    return true
  }

  public clear (): void {
    this.previous?.destroy()
    this.target?.destroy()
    this.previous = this.target = undefined
  }

  public destroy (): void {
    this.clear()
    this.uniform.destroy()
    this.kernel.destroy()
  }
}
