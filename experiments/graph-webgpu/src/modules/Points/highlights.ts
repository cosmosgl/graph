import { Buffer, type Device, type ShaderLayout } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import records from '../../style-records.wgsl?raw'
import patch from './highlight-points.wgsl?raw'

/** Each set bit marks a greyed point. Empty selection greys every point; absent selection clears every bit. */
export class PointHighlightMask {
  public readonly words: Uint32Array
  public readonly greyCount: number

  public constructor (public readonly count: number, indices?: readonly number[]) {
    this.words = new Uint32Array(Math.ceil(count / 32))
    let greyCount = 0
    if (indices) {
      this.words.fill(0xffffffff)
      if (count % 32) this.words[this.words.length - 1] = 0xffffffff >>> (32 - count % 32)
      greyCount = count
      for (const id of indices) {
        if (!Number.isInteger(id) || id < 0 || id >= count) continue
        const word = id >>> 5
        const bit = 1 << (id & 31)
        if ((this.words[word]! & bit) !== 0) {
          this.words[word]! &= ~bit
          greyCount--
        }
      }
    }
    this.greyCount = greyCount
  }

  public get splitsOrder (): boolean { return this.greyCount > 0 && this.greyCount < this.count }

  public isGreyed (id: number): boolean { return (this.words[id >>> 5]! & (1 << (id & 31))) !== 0 }

  public drawOrder (base?: Uint32Array): Uint32Array {
    if (!this.splitsOrder && base) return base
    const order = new Uint32Array(this.count)
    let back = 0
    let front = this.greyCount
    for (let i = 0; i < this.count; i++) {
      const id = base?.[i] ?? i
      if (this.isGreyed(id)) order[back++] = id
      else order[front++] = id
    }
    return order
  }

  public changesFrom (previous: PointHighlightMask): Uint32Array {
    let first = 0
    let end = this.words.length
    while (first < end && this.words[first] === previous.words[first]) first++
    while (end > first && this.words[end - 1] === previous.words[end - 1]) end--
    const changes = new Uint32Array((end - first) * 3)
    let at = 0
    for (let word = first; word < end; word++) {
      const grey = this.words[word]!
      const changed = grey ^ previous.words[word]!
      if (changed) {
        changes[at++] = word
        changes[at++] = changed
        changes[at++] = grey
      }
    }
    return changes.subarray(0, at)
  }
}

const layout: ShaderLayout = {
  attributes: [],
  bindings: [
    { name: 'points', type: 'storage', group: 0, location: 0 },
    { name: 'changes', type: 'read-only-storage', group: 0, location: 1 },
    { name: 'opacity', type: 'uniform', group: 0, location: 2 },
  ],
}

/** Patch the resident target in place so gradients, picking and future transitions see exactly the same record. */
export class PointHighlightPass {
  private kernel?: Kernel

  public constructor (private readonly device: Device) {}

  public apply (points: Buffer, changes: Uint32Array, normalOpacity: number, greyOpacity: number): void {
    const device = this.device
    this.kernel ??= new Kernel(device, { id: 'cosmos-point-highlights', source: records + patch, shaderLayout: layout })
    const resources: Array<{ destroy(): void }> = []
    try {
      const changesBuffer = device.createBuffer({ data: changes, usage: Buffer.STORAGE })
      resources.push(changesBuffer)
      const opacity = device.createBuffer({ data: new Float32Array([normalOpacity, greyOpacity]), usage: Buffer.UNIFORM })
      resources.push(opacity)
      const groups = Math.ceil(changes.length / 6) // Two 32-point words per workgroup.
      const x = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension)
      const encoder = device.createCommandEncoder()
      resources.push(encoder)
      const pass = encoder.beginComputePass({})
      try {
        this.kernel.dispatch(pass, { x, y: Math.ceil(groups / x), bindings: { points, changes: changesBuffer, opacity } })
      } finally { pass.end() }
      device.submit(encoder.finish())
    } finally {
      for (const resource of resources) resource.destroy()
    }
  }

  public destroy (): void {
    this.kernel?.destroy()
  }
}
