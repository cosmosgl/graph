import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import type { Kernel } from '@luma.gl/graph'
import type { Store } from '@/graph/modules/Store'
import { kernel, upload } from '../Shared/compute'
import type { resourceScope } from '../Shared/resource-scope'
import source from './force-gravity.wgsl?raw'

type Scope = ReturnType<typeof resourceScope>
type Gravity = (pass: ComputePass, positions: Buffer, output: Buffer, strength: number) => void

export function createGravityKernel (device: Device, scope: Scope): Kernel {
  return kernel(device, scope, source, 'gravity', [['positions', 'read-only-storage'], ['output', 'storage'], ['params', 'uniform']])
}

export function createGravity (device: Device, scope: Scope, program: Kernel, groups: number, store: Store): Gravity {
  const params = scope.own(upload(device, new Float32Array(4), Buffer.UNIFORM))
  return (pass, positions, output, strength): void => {
    params.write(new Float32Array([...store.worldOrigin, store.alpha, strength]))
    program.dispatch(pass, { x: groups, bindings: { positions, output, params } })
  }
}
