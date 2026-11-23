import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { resourceScope } from '../Shared/resource-scope'
import { kernel, upload } from '../Shared/compute'
import type { ForcePass } from '../Shared/force-pass'
import mouseSource from './force-mouse.wgsl?raw'

const read = 'read-only-storage'
const write = 'storage'
const uniform = 'uniform'

export function createPointerForce (device: Device, count: number): ForcePass<[forces: Buffer, x: number, y: number, strength: number]> {
  const scope = resourceScope()
  try {
    const params = scope.own(upload(device, new Float32Array(4), Buffer.UNIFORM))
    const force = kernel(device, scope, mouseSource, 'main', [['positions', read], ['forces', write], ['params', uniform]])
    return {
      encode (pass: ComputePass, positions: Buffer, forces: Buffer, x: number, y: number, strength: number): void {
        params.write(new Float32Array([x, y, strength, count]))
        force.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, forces, params } })
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
