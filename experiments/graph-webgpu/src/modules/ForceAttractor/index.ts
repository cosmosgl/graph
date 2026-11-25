import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import type { GraphData } from '@/graph/modules/GraphData'
import { resourceScope } from '../Shared/resource-scope'
import { kernel, upload } from '../Shared/compute'
import type { ForcePass } from '../Shared/force-pass'
import arithmetic from '../Shared/attraction-arithmetic.wgsl?raw'
import attractorSource from './force-attractor.wgsl?raw'

const read = 'read-only-storage'
const write = 'storage'
const uniform = 'uniform'
type Attraction = ForcePass<[forces: Buffer, alpha: number, strength: number]>

export class ForceAttractor implements Attraction {
  private readonly scope = resourceScope()
  private readonly attractors: Buffer
  private readonly params: Buffer
  private readonly program: Kernel
  private readonly count: number

  private constructor (device: Device, packed: Float32Array) {
    this.count = packed.length / 4
    try {
      this.attractors = this.scope.own(upload(device, packed))
      this.params = this.scope.own(upload(device, new Float32Array(4), Buffer.UNIFORM))
      this.program = kernel(device, this.scope, arithmetic + attractorSource, 'main',
        [['positions', read], ['attractors', read], ['forces', write], ['params', uniform]])
    } catch (error) {
      this.scope.destroy()
      throw error
    }
  }

  public static create (device: Device, data: GraphData): ForceAttractor | undefined {
    if (!data.pointAttractors) return undefined
    const count = data.pointsNumber!
    const packed = new Float32Array(count * 4)
    let active = false
    for (let i = 0; i < count; i++) {
      const x = data.pointAttractors[2 * i]!
      const y = data.pointAttractors[2 * i + 1]!
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const strength = data.pointAttractorStrength?.[i]
      packed.set([x, y, strength !== undefined && Number.isFinite(strength) ? strength : 1, 1], i * 4)
      active = true
    }
    if (!active) return undefined
    return new ForceAttractor(device, packed)
  }

  public encode (pass: ComputePass, positions: Buffer, forces: Buffer, alpha: number, strength: number): void {
    this.params.write(new Float32Array([this.count, alpha, strength, 0]))
    this.program.dispatch(pass, { x: Math.ceil(this.count / 64), bindings: { positions, attractors: this.attractors, forces, params: this.params } })
  }

  public destroy (): void {
    this.scope.destroy()
  }
}
