import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import { kernel, upload, type WorkgroupGrid } from '../Shared/compute'
import type { resourceScope } from '../Shared/resource-scope'
import source from './force-center.wgsl?raw'
import reduction from './reduce-centroid.wgsl?raw'

type Scope = ReturnType<typeof resourceScope>

export function createCenterKernel (device: Device, scope: Scope): Kernel {
  return kernel(device, scope, source, 'center',
    [['positions', 'read-only-storage'], ['output', 'storage'], ['params', 'uniform'], ['centroid', 'read-only-storage']])
}

export function createCentroidKernel (device: Device, scope: Scope): Kernel {
  return kernel(device, scope, reduction, 'main', [['input', 'read-only-storage'], ['output', 'storage'], ['params', 'uniform']])
}

export class ForceCenter {
  private readonly params: Buffer

  public constructor (device: Device, scope: Scope, private readonly program: Kernel, private readonly groups: WorkgroupGrid) {
    this.params = scope.own(upload(device, new Float32Array(4), Buffer.UNIFORM))
  }

  public encode (pass: ComputePass, positions: Buffer, output: Buffer, centroid: Buffer, alpha: number, strength: number): void {
    this.params.write(new Float32Array([0, 0, alpha, strength]))
    this.program.dispatch(pass, { ...this.groups, bindings: { positions, output, params: this.params, centroid } })
  }
}
