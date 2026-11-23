import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import { kernel, upload } from '../Shared/compute'
import type { resourceScope } from '../Shared/resource-scope'
import source from './force-center.wgsl?raw'
import reduction from './reduce-centroid.wgsl?raw'

type Scope = ReturnType<typeof resourceScope>
type Center = (pass: ComputePass, positions: Buffer, output: Buffer, centroid: Buffer, alpha: number, strength: number) => void

export function createCenterKernel (device: Device, scope: Scope): Kernel {
  return kernel(device, scope, source, 'center',
    [['positions', 'read-only-storage'], ['output', 'storage'], ['params', 'uniform'], ['centroid', 'read-only-storage']])
}

export function createCentroidKernel (device: Device, scope: Scope): Kernel {
  return kernel(device, scope, reduction, 'main', [['input', 'read-only-storage'], ['output', 'storage'], ['params', 'uniform']])
}

export function createCenter (device: Device, scope: Scope, program: Kernel, groups: number): Center {
  const params = scope.own(upload(device, new Float32Array(4), Buffer.UNIFORM))
  return (pass, positions, output, centroid, alpha, strength): void => {
    params.write(new Float32Array([0, 0, alpha, strength]))
    program.dispatch(pass, { x: groups, bindings: { positions, output, params, centroid } })
  }
}
