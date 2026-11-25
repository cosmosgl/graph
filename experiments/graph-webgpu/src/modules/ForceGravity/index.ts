import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import type { Store } from '@/graph/modules/Store'
import { kernel, upload } from '../Shared/compute'
import type { resourceScope } from '../Shared/resource-scope'
import source from './force-gravity.wgsl?raw'

type Scope = ReturnType<typeof resourceScope>

export function createGravityKernel (device: Device, scope: Scope): Kernel {
  return kernel(device, scope, source, 'gravity', [['positions', 'read-only-storage'], ['output', 'storage'], ['params', 'uniform']])
}

export class ForceGravity {
  private readonly params: Buffer

  public constructor (
    device: Device, scope: Scope, private readonly program: Kernel, private readonly groups: number, private readonly store: Store
  ) {
    this.params = scope.own(upload(device, new Float32Array(4), Buffer.UNIFORM))
  }

  public encode (pass: ComputePass, positions: Buffer, output: Buffer, strength: number): void {
    this.params.write(new Float32Array([...this.store.worldOrigin, this.store.alpha, strength]))
    this.program.dispatch(pass, { x: this.groups, bindings: { positions, output, params: this.params } })
  }
}
