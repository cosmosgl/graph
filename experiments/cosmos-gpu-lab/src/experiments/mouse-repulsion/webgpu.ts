import { Buffer, type ComputePass, type Device } from '@luma.gl/core'
import { Kernel } from '@luma.gl/graph'
import { bindingLayout, upload } from '../../gpu/luma'
import { resourceScope, type BufferLedger } from '../../gpu/resource-scope'
import { pointerUniform, type Vector } from './data'
import source from './force.wgsl?raw'

export async function createMouseWebGPU (device: Device, forces: Buffer, ledger?: BufferLedger): Promise<{
  prepare(count: number, world: Vector, strength: number): void;
  encode(pass: ComputePass, positions: Buffer): void;
  destroy(): void;
}> {
  const scope = resourceScope(ledger)
  try {
    const params = scope.own(upload(device, new Float32Array(4), Buffer.UNIFORM))
    const kernel = scope.own(await Kernel.createAsync(device, {
      source,
      shaderLayout: {
        bindings: bindingLayout([
          ['positions', 'read-only-storage'], ['forces', 'storage'], ['params', 'uniform'],
        ]),
      },
    }))
    let count = 0
    return {
      prepare (next, world, strength): void {
        if (!Number.isInteger(next) || next < 0 || next > forces.byteLength / 16) throw new Error('Invalid pointer force count')
        params.write(new Float32Array([...pointerUniform(world, strength), next]))
        count = next
      },
      encode (pass, positions): void {
        if (count) kernel.dispatch(pass, { x: Math.ceil(count / 64), bindings: { positions, forces, params } })
      },
      destroy: scope.destroy,
    }
  } catch (error) { scope.destroy(); throw error }
}
