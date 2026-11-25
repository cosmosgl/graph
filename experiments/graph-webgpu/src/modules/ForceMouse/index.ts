import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import { resourceScope } from '../Shared/resource-scope'
import { kernel, upload } from '../Shared/compute'
import type { ForcePass } from '../Shared/force-pass'
import mouseSource from './force-mouse.wgsl?raw'

const read = 'read-only-storage'
const write = 'storage'
const uniform = 'uniform'

export class ForceMouse implements ForcePass<[forces: Buffer, x: number, y: number, strength: number]> {
  private readonly scope = resourceScope()
  private readonly params: Buffer
  private readonly program: Kernel

  public constructor (device: Device, private readonly count: number) {
    try {
      this.params = this.scope.own(upload(device, new Float32Array(4), Buffer.UNIFORM))
      this.program = kernel(device, this.scope, mouseSource, 'main', [['positions', read], ['forces', write], ['params', uniform]])
    } catch (error) {
      this.scope.destroy()
      throw error
    }
  }

  public encode (pass: ComputePass, positions: Buffer, forces: Buffer, x: number, y: number, strength: number): void {
    this.params.write(new Float32Array([x, y, strength, this.count]))
    this.program.dispatch(pass, { x: Math.ceil(this.count / 64), bindings: { positions, forces, params: this.params } })
  }

  public destroy (): void {
    this.scope.destroy()
  }
}
